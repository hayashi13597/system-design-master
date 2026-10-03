import { redis } from "./core";
const bucket = `
local v=redis.call('HMGET',KEYS[1],'tokens','time')
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local capacity=tonumber(ARGV[1]); local period=tonumber(ARGV[2])
local tokens=math.min(capacity,tonumber(v[1] or capacity)+math.max(0,now-tonumber(v[2] or now))*capacity/period)
local allowed=0; if tokens>=1 then tokens=tokens-1; allowed=1 end
redis.call('HSET',KEYS[1],'tokens',tokens,'time',now); redis.call('PEXPIRE',KEYS[1],period*2)
return {allowed,math.floor(tokens),math.max(1,math.ceil((1-tokens)*period/capacity/1000))}
`;
const sliding = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local period=tonumber(ARGV[2]); local boundary=math.floor(now/period)*period
local current=KEYS[1]..':'..boundary; local previous=KEYS[1]..':'..(boundary-period)
local count=tonumber(redis.call('GET',current) or 0)
local estimate=count+tonumber(redis.call('GET',previous) or 0)*(1-(now-boundary)/period)
local allowed=0
if estimate<tonumber(ARGV[1]) then redis.call('INCR',current); redis.call('PEXPIRE',current,period*2); allowed=1; estimate=estimate+1 end
return {allowed,math.max(0,math.floor(tonumber(ARGV[1])-estimate)),1}
`;
export async function limit(
  key: string,
  capacity = 5,
  period = 1000,
  mode = "token-bucket",
) {
  const result = (await redis.eval(
    mode === "sliding" ? sliding : bucket,
    1,
    `quota:${key}`,
    capacity,
    period,
  )) as number[];
  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfter: result[2],
    limit: capacity,
  };
}
