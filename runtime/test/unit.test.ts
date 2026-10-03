import test from "node:test";
import assert from "node:assert/strict";
process.env.LAB = "00";
process.env.DB_URL = "postgres://unused:unused@localhost/unused";
test("consistent hashing and Snowflake invariants", async () => {
  const { route, Snowflake } = await import("../src/sharding");
  const before = ["a", "b", "c"],
    after = [...before, "d"];
  let moved = 0;
  for (let i = 0; i < 10000; i++) {
    const old = route(String(i), before),
      next = route(String(i), after);
    if (old !== next) {
      moved++;
      assert.equal(next, "d");
    }
  }
  assert.ok(moved > 1000 && moved < 4000);
  const a = new Snowflake(1),
    b = new Snowflake(2);
  const timestamp = Date.now();
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    ids.add(a.next(timestamp));
    ids.add(b.next(timestamp));
  }
  assert.equal(ids.size, 2000);
  assert.throws(() => a.next(timestamp - 1), /backwards/);
  assert.throws(() => new Snowflake(1024), /worker/);
  const { db, redis } = await import("../src/core");
  await db.end();
  redis.disconnect();
});
