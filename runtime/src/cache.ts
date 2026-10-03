import { randomUUID } from "crypto";
import { db, redis, dbQueries, HttpError } from "./core";
const flights = new Map<string, Promise<unknown>>();
export async function loadProduct(id: string) {
  dbQueries.inc();
  await db.query("UPDATE query_stats SET count=count+1");
  await db.query("SELECT pg_sleep(0.03)");
  return (
    (await db.query("SELECT * FROM products WHERE id=$1", [id])).rows[0] || null
  );
}
export async function getProduct(id: string, mode: string) {
  if (mode === "none") return loadProduct(id);
  const key = `product:${id}`;
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit);
  const load = async () => {
    // Recheck after winning the distributed lock.
    const cached = await redis.get(key);
    if (cached !== null) return JSON.parse(cached);
    const result = await loadProduct(id);
    await redis.set(
      key,
      JSON.stringify(result),
      "PX",
      result ? 2000 + Math.floor(Math.random() * 400) : 500,
    );
    return result;
  };
  if (mode === "naive") {
    const result = await loadProduct(id);
    await redis.set(key, JSON.stringify(result), "PX", 2000);
    return result;
  }
  if (mode === "singleflight") {
    let pending = flights.get(id);
    if (!pending) {
      pending = load().finally(() => flights.delete(id));
      flights.set(id, pending);
    }
    return pending;
  }
  if (mode !== "distributed")
    throw new HttpError(
      400,
      "mode must be none, naive, singleflight or distributed",
    );
  const token = randomUUID();
  const lock = `cache-lock:${id}`;
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (await redis.set(lock, token, "PX", 2000, "NX")) {
      try {
        return await load();
      } finally {
        await redis.eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
          1,
          lock,
          token,
        );
      }
    }
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 20));
    const result = await redis.get(key);
    if (result !== null) return JSON.parse(result);
  }
  throw new HttpError(503, "Cache regeneration busy");
}
