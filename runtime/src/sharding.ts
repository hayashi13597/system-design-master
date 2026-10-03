import { Pool } from "pg";
import { createHash } from "crypto";
import { db, transaction, HttpError } from "./core";
export const shards = new Map<string, Pool>();
if (process.env.LAB === "05")
  for (const name of ["shard1", "shard2", "shard3", "shard4"])
    shards.set(
      name,
      new Pool({
        connectionString: `postgres://postgres:lab_password@${name}:5432/lab`,
        connectionTimeoutMillis: 2000,
        max: 3,
        statement_timeout: 5000,
      }),
    );
const rings = new Map<string, { node: string; hash: number }[]>();
export function route(key: string, nodes: string[]): string {
  if (!nodes.length) throw new Error("Empty hash ring");
  const hash = (s: string) =>
    createHash("sha256").update(s).digest().readUInt32BE(0);
  const signature = JSON.stringify(nodes);
  let ring = rings.get(signature);
  if (!ring) {
    ring = nodes
      .flatMap((node) =>
        Array.from({ length: 50 }, (_, i) => ({
          node,
          hash: hash(`${node}:${i}`),
        })),
      )
      .sort((a, b) => a.hash - b.hash);
    rings.set(signature, ring);
  }
  const h = hash(key);
  let low = 0,
    high = ring.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ring[mid].hash < h) low = mid + 1;
    else high = mid;
  }
  return ring[low % ring.length].node;
}
export class Snowflake {
  private last = -1n;
  private sequence = 0n;
  constructor(private worker: number) {
    if (!Number.isInteger(worker) || worker < 0 || worker > 1023)
      throw new Error("Invalid worker ID");
  }
  next(now = Date.now()): string {
    const ms = BigInt(now) - 1704067200000n;
    if (ms < 0n || ms < this.last)
      throw new HttpError(503, "Clock moved backwards");
    this.sequence = ms === this.last ? this.sequence + 1n : 0n;
    if (this.sequence > 4095n)
      throw new HttpError(503, "Sequence exhausted; retry next millisecond");
    this.last = ms;
    return (
      (ms << 22n) |
      (BigInt(this.worker) << 12n) |
      this.sequence
    ).toString();
  }
}
const ids = new Snowflake(Number(process.env.WORKER_ID || 0));
export async function createUser(name: string, email: string) {
  return transaction(async (c) => {
    // The shared advisory lock makes maintenance wait for in-flight operations.
    await c.query("SELECT pg_advisory_xact_lock_shared(5005)");
    const config = (await c.query("SELECT * FROM routing")).rows[0];
    if (config.state !== "ACTIVE")
      throw new HttpError(503, "Reshard maintenance");
    const id = ids.next();
    const target = route(id, config.nodes);
    const result = await shards
      .get(target)!
      .query("INSERT INTO users VALUES ($1,$2,$3) RETURNING *", [
        id,
        name,
        email,
      ]);
    return {
      user: result.rows[0],
      targetShard: target,
      routingVersion: config.version,
    };
  });
}
export async function getUser(id: string) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock_shared(5005)");
    const config = (await c.query("SELECT * FROM routing")).rows[0];
    if (config.state !== "ACTIVE")
      throw new HttpError(503, "Reshard maintenance");
    const target = route(id, config.nodes);
    const result = await shards
      .get(target)!
      .query("SELECT * FROM users WHERE id=$1", [id]);
    return {
      user: result.rows[0] || null,
      queriedShard: target,
      routingVersion: config.version,
    };
  });
}
export async function reshard() {
  // Offline, resumable copy. Original copies are retained until verification succeeds.
  const c = await db.connect();
  try {
    await c.query("SELECT pg_advisory_lock(5005)");
    const config = (await c.query("SELECT * FROM routing")).rows[0];
    const nodes = ["shard1", "shard2", "shard3", "shard4"];
    await shards.get("shard4")!.query("SELECT 1");
    await c.query("UPDATE routing SET state='MAINTENANCE'");
    const users = (
      await Promise.all(
        (config.nodes as string[]).map((n) =>
          shards.get(n)!.query("SELECT * FROM users"),
        ),
      )
    ).flatMap((r) => r.rows);
    const unique = new Map(users.map((u) => [u.id, u]));
    for (const u of unique.values()) {
      const target = shards.get(route(u.id, nodes))!;
      await target.query(
        "INSERT INTO users VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
        [u.id, u.name, u.email],
      );
      const copy = (
        await target.query("SELECT * FROM users WHERE id=$1", [u.id])
      ).rows[0];
      if (copy.name !== u.name || copy.email !== u.email)
        throw new Error("Copy verification failed");
    }
    await c.query(
      "UPDATE routing SET nodes=$1,version=version+1,state='ACTIVE'",
      [JSON.stringify(nodes)],
    );
    for (const [n, p] of shards)
      for (const u of unique.values())
        if (route(u.id, nodes) !== n)
          await p.query("DELETE FROM users WHERE id=$1", [u.id]);
    return { count: unique.size, nodes };
  } finally {
    await c.query("SELECT pg_advisory_unlock(5005)");
    c.release();
  }
}
