import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Redis from "ioredis";
import amqp from "amqplib";
import { Kafka, logLevel } from "kafkajs";
import path from "node:path";
const lab = process.env.LAB!;
const dirs: Record<string, string> = {
  "00": "module-00-foundations",
  "01": "module-01-load-balancing",
  "02": "module-02-caching-patterns",
  "03": "module-03-rate-limiter",
  "04": "module-04-db-replication",
  "05": "module-05-db-sharding",
  "06": "module-06-distributed-lock",
  "07": "module-07-message-queues",
  "08": "module-08-outbox-kafka",
  "09": "capstone-flash-sale",
  "10": "module-10-reliability",
};
const db = new Pool({
  connectionString: process.env.DB_URL,
  connectionTimeoutMillis: 2000,
});
db.on("error", () => {}); // Fault-injection stops PostgreSQL; idle pool errors are expected here.
const redis = new Redis(process.env.REDIS_URL!, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
redis.on("error", () => {});
const compose = [
  "compose",
  "-f",
  path.resolve("labs", dirs[lab], "docker-compose.yml"),
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function docker(...args: string[]) {
  return execFileSync("docker", [...compose, ...args], {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function eventually(check: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (e) {
      error = e;
    }
    await sleep(150);
  }
  throw new Error(`Condition did not become true: ${String(error)}`);
}
async function request(
  p: string,
  body?: unknown,
  headers: Record<string, string> = {},
  base = "http://localhost:8080",
) {
  const response = await fetch(base + p, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    data: (await response.json()) as any,
    headers: response.headers,
  };
}
async function stop(service: string, fn: () => Promise<void>) {
  docker("stop", "-t", "2", service);
  try {
    await fn();
  } finally {
    docker("start", service);
    await eventually(async () => {
      const status = docker("ps", "--format", "json", service);
      return status.includes("running");
    });
  }
}
async function fresh() {
  await db.query(
    "TRUNCATE requests,deliveries,processed_messages,outbox,orders",
  );
  await db.query(
    "UPDATE sales SET initial_stock=50,stock=50; UPDATE accounts SET balance=0; UPDATE query_stats SET count=0;",
  );
  if (["01", "02", "03", "06", "09"].includes(lab)) {
    await redis.connect();
    await redis.flushdb();
  }
}
test(
  `lab ${lab}: real infrastructure integration`,
  { timeout: 240000 },
  async (t) => {
    try {
      await eventually(
        async () => (await request("/health/ready")).status === 200,
      );
      await fresh();
      const metrics = await fetch("http://localhost:3001/metrics");
      assert.equal(metrics.status, 200);
      assert.match(await metrics.text(), /lab_http_duration_seconds/);
      if (lab === "00") {
        await db.query("DROP INDEX IF EXISTS foundation_category");
        const before = await request("/api/index/plan");
        assert.match(JSON.stringify(before.data), /Seq Scan/);
        assert.equal((await request("/api/index/create", {})).status, 200);
        const after = await request("/api/index/plan");
        assert.match(JSON.stringify(after.data), /Index/);
        await Promise.all(
          Array.from({ length: 20 }, () =>
            request("/api/isolation/unsafe", {}),
          ),
        );
        const unsafe = Number(
          (await db.query("SELECT balance FROM accounts WHERE id='demo'"))
            .rows[0].balance,
        );
        assert.ok(unsafe < 20);
        await db.query("UPDATE accounts SET balance=0 WHERE id='demo'");
        await Promise.all(
          Array.from({ length: 20 }, () =>
            request("/api/isolation/atomic", {}),
          ),
        );
        assert.equal(
          Number(
            (await db.query("SELECT balance FROM accounts WHERE id='demo'"))
              .rows[0].balance,
          ),
          20,
        );
      }
      if (lab === "01") {
        const local = await Promise.all(
          Array.from({ length: 12 }, () =>
            request("/api/stateful/increment", {}),
          ),
        );
        assert.equal(new Set(local.map((r) => r.data.instance)).size, 3);
        const shared = await Promise.all(
          Array.from({ length: 60 }, () =>
            request("/api/shared/increment", {}),
          ),
        );
        assert.equal(new Set(shared.map((r) => r.data.counter)).size, 60);
        assert.equal(await redis.get("shared-counter"), "60");
        await stop("app-1", async () => {
          await sleep(2200);
          for (let i = 0; i < 12; i++)
            assert.equal((await request("/api/info")).status, 200);
        });
      }
      if (lab === "02") {
        const burst = (mode: string) =>
          Promise.all(
            Array.from({ length: 30 }, (_, i) =>
              request(
                `/api/products/1?mode=${mode}`,
                undefined,
                {},
                `http://localhost:${i % 2 ? 3001 : 3002}`,
              ),
            ),
          );
        await burst("naive");
        const naive = (await db.query("SELECT count::int FROM query_stats"))
          .rows[0].count;
        assert.ok(naive > 1);
        await redis.flushdb();
        await db.query("UPDATE query_stats SET count=0");
        const results = await burst("distributed");
        assert.ok(results.every((r) => r.status === 200));
        assert.equal(
          (await db.query("SELECT count::int FROM query_stats")).rows[0].count,
          1,
        );
        await Promise.all(
          Array.from({ length: 20 }, () =>
            request("/api/products/missing?mode=distributed"),
          ),
        );
        assert.equal(
          (await db.query("SELECT count::int FROM query_stats")).rows[0].count,
          2,
        );
        const updated = await fetch("http://localhost:8080/api/products/1", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        });
        assert.equal(updated.status, 200);
        assert.equal(
          (await request("/api/products/1")).data.product.name,
          "Updated",
        );
        await stop("redis", async () => {
          const base = "http://localhost:3001";
          assert.equal(
            (await request("/api/products/1", undefined, {}, base)).status,
            503,
          );
          assert.equal(
            (await request("/health/live", undefined, {}, base)).status,
            200,
          );
          assert.equal(
            (await request("/health/ready", undefined, {}, base)).status,
            503,
          );
        });
      }
      if (lab === "03") {
        const started = Date.now();
        const results = await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            request(
              "/api/limit/token-bucket",
              undefined,
              { "X-User-ID": "burst" },
              `http://localhost:${i % 2 ? 3001 : 3002}`,
            ),
          ),
        );
        const successes = results.filter((r) => r.status === 200).length;
        assert.ok(successes >= 25);
        assert.ok(
          successes <= 25 + Math.ceil(((Date.now() - started) * 25) / 1000),
        );
        assert.ok(
          results.some((r) => r.status === 429 && r.headers.has("Retry-After")),
        );
        const sliding = await Promise.all(
          Array.from({ length: 80 }, () =>
            request("/api/limit/sliding", undefined, {
              "X-User-ID": "sliding",
            }),
          ),
        );
        assert.ok(sliding.some((r) => r.status === 429));
        const unsafe = await Promise.all(
          Array.from({ length: 80 }, () =>
            request("/api/limit/unsafe", undefined, { "X-User-ID": "unsafe" }),
          ),
        );
        assert.ok(unsafe.filter((r) => r.status === 200).length > 25);
      }
      if (lab === "04") {
        const sql = (n: number, q: string) =>
          docker(
            "exec",
            "-T",
            `replica${n}`,
            "psql",
            "-U",
            "postgres",
            "-d",
            "lab",
            "-Atc",
            q,
          ).trim();
        await eventually(
          async () =>
            Number(sql(1, "SELECT version FROM profiles WHERE id='user_1'")) >=
            1,
        );
        sql(1, "SELECT pg_wal_replay_pause()");
        sql(2, "SELECT pg_wal_replay_pause()");
        try {
          const write = await request("/api/profiles/user_1", {
            bio: randomUUID(),
          });
          assert.equal(write.status, 200);
          const stale = await request("/api/profiles/user_1");
          assert.ok(stale.data.version < write.data.version);
          for (const port of [3001, 3002]) {
            const read = await request(
              "/api/profiles/user_1",
              undefined,
              { "X-Min-LSN": write.data.lsn },
              `http://localhost:${port}`,
            );
            assert.equal(read.data.bio, write.data.bio);
            assert.equal(read.data.servedBy, "primary");
          }
        } finally {
          sql(1, "SELECT pg_wal_replay_resume()");
          sql(2, "SELECT pg_wal_replay_resume()");
        }
        const primary = (
          await db.query("SELECT version FROM profiles WHERE id='user_1'")
        ).rows[0].version;
        await eventually(
          async () =>
            Number(sql(1, "SELECT version FROM profiles WHERE id='user_1'")) ===
            primary,
        );
      }
      if (lab === "05") {
        const created = await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            request("/api/users", {
              name: `User ${i}`,
              email: `u${i}@example.test`,
            }),
          ),
        );
        assert.ok(created.every((r) => r.status === 201));
        assert.equal(new Set(created.map((r) => r.data.user.id)).size, 100);
        const reshard = spawnSync(
          "node",
          ["scripts/lab.mjs", "reshard", "05"],
          { encoding: "utf8", timeout: 60000 },
        );
        assert.equal(reshard.status, 0, reshard.stderr);
        for (const r of created) {
          const read = await request(`/api/users/${r.data.user.id}`);
          assert.equal(read.status, 200);
          assert.equal(read.data.user.name, r.data.user.name);
          assert.equal(read.data.routingVersion, 2);
        }
        assert.equal((await request("/api/users")).data.users.length, 100);
      }
      if (lab === "06") {
        const a = await request("/api/lock/acquire", {});
        assert.equal(a.status, 201);
        assert.equal((await request("/api/lock/acquire", {})).status, 409);
        await sleep(550);
        const b = await request("/api/lock/acquire", {});
        assert.equal(b.status, 201);
        assert.ok(BigInt(b.data.fence) > BigInt(a.data.fence));
        assert.equal(
          (await request("/api/lock/release", { token: a.data.token })).data
            .released,
          false,
        );
        assert.equal(
          (await request("/api/inventory/deduct", b.data)).status,
          200,
        );
        assert.equal(
          (await request("/api/inventory/deduct", a.data)).status,
          409,
        );
        const stale = await db.query(
          "UPDATE lock_inventory SET stock=stock-1,fence=$1 WHERE id='demo' AND fence<$1 RETURNING *",
          [a.data.fence],
        );
        assert.equal(stale.rowCount, 0);
      }
      if (lab === "07") {
        const dup = await Promise.all(
          Array.from({ length: 30 }, () =>
            request("/api/payments", {
              idempotencyKey: "same-payment",
              amount: 100,
            }),
          ),
        );
        assert.ok(dup.every((r) => r.status === 202));
        await eventually(
          async () =>
            Number(
              (await db.query("SELECT balance FROM accounts WHERE id='demo'"))
                .rows[0].balance,
            ) === 100,
        );
        await sleep(500);
        assert.equal(
          Number(
            (await db.query("SELECT balance FROM accounts WHERE id='demo'"))
              .rows[0].balance,
          ),
          100,
        );
        await request("/api/payments", {
          idempotencyKey: "poison",
          amount: 1,
          poison: true,
        });
        const conn = await amqp.connect(process.env.RABBIT_URL!);
        const ch = await conn.createChannel();
        await eventually(
          async () => (await ch.checkQueue("lab.dlq")).messageCount === 1,
        );
        await conn.close();
        // Committed business effect survives crash before ACK; redelivery deduplicates.
        docker("stop", "-t", "2", "consumer-1", "consumer-2");
        await request("/api/payments", {
          idempotencyKey: "crash-payment",
          amount: 100,
        });
        const crash = spawnSync(
          "docker",
          [
            ...compose,
            "run",
            "--rm",
            "--no-deps",
            "-e",
            "CRASH_BEFORE_ACK=1",
            "consumer-1",
          ],
          { encoding: "utf8", timeout: 30000 },
        );
        assert.equal(crash.status, 87, crash.stderr);
        docker("start", "consumer-1", "consumer-2");
        await sleep(1200);
        assert.equal(
          Number(
            (await db.query("SELECT balance FROM accounts WHERE id='demo'"))
              .rows[0].balance,
          ),
          200,
        );
      }
      if (lab === "08") {
        await stop("redpanda", async () => {
          const accepted = await request(
            "/api/orders",
            { userId: "u1" },
            { "Idempotency-Key": "event-1" },
          );
          assert.equal(accepted.status, 202);
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS n FROM outbox WHERE status='PENDING'",
              )
            ).rows[0].n,
            1,
          );
        });
        await eventually(
          async () =>
            (await db.query("SELECT count(*)::int AS n FROM deliveries"))
              .rows[0].n === 1,
          60000,
        );
        docker("stop", "-t", "2", "relay");
        await request(
          "/api/orders",
          { userId: "u2" },
          { "Idempotency-Key": "event-2" },
        );
        const crash = spawnSync(
          "docker",
          [
            ...compose,
            "run",
            "--rm",
            "--no-deps",
            "-e",
            "CRASH_AFTER_PUBLISH=1",
            "relay",
          ],
          { encoding: "utf8", timeout: 45000 },
        );
        assert.equal(crash.status, 86, crash.stderr);
        docker("start", "relay");
        await eventually(
          async () =>
            (await db.query("SELECT count(*)::int AS n FROM deliveries"))
              .rows[0].n === 2,
          60000,
        );
        await sleep(1000);
        assert.equal(
          (await db.query("SELECT count(*)::int AS n FROM processed_messages"))
            .rows[0].n,
          2,
        );
      }
      if (lab === "09") {
        for (const quantity of [-1, 0, 1.5, 2, "1"])
          assert.equal(
            (
              await request(
                "/api/flash-sale/buy",
                { userId: "buyer_9000", quantity },
                { "Idempotency-Key": randomUUID() },
              )
            ).status,
            400,
          );
        const results = await Promise.all(
          Array.from({ length: 1000 }, (_, i) =>
            request(
              "/api/flash-sale/buy",
              { userId: `buyer_${i}` },
              { "Idempotency-Key": `buy-${i}` },
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === 202).length, 50);
        assert.equal(results.filter((r) => r.status === 409).length, 950);
        assert.equal(
          (await db.query("SELECT stock FROM sales")).rows[0].stock,
          0,
        );
        assert.equal(
          (await db.query("SELECT count(*)::int AS n FROM orders")).rows[0].n,
          50,
        );
        const winner = results.findIndex((r) => r.status === 202);
        const order = results[winner].data.orderId;
        assert.equal(
          (
            await request(
              "/api/flash-sale/buy",
              { userId: `buyer_${winner}` },
              { "Idempotency-Key": `buy-${winner}` },
            )
          ).data.orderId,
          order,
        );
        assert.equal(
          (
            await request(
              "/api/flash-sale/buy",
              { userId: "buyer_9999" },
              { "Idempotency-Key": `buy-${winner}` },
            )
          ).status,
          409,
        );
        for (const port of [3001, 3002])
          assert.equal(
            (
              await request(
                `/api/flash-sale/order/${order}`,
                undefined,
                {},
                `http://localhost:${port}`,
              )
            ).status,
            200,
          );
        assert.equal(
          (
            await request(
              "/api/flash-sale/order/00000000-0000-0000-0000-000000000000",
            )
          ).status,
          404,
        );
        await eventually(
          async () =>
            (await db.query("SELECT count(*)::int AS n FROM deliveries"))
              .rows[0].n === 50,
        );
        docker("restart", "app-1", "app-2");
        await eventually(
          async () =>
            (await request(`/api/flash-sale/order/${order}`)).status === 200,
        );
        // Broker outage preserves committed reservations and pending outbox rows.
        await db.query("UPDATE sales SET initial_stock=51,stock=1");
        await stop("rabbitmq", async () => {
          assert.equal(
            (
              await request(
                "/api/flash-sale/buy",
                { userId: "buyer_2000" },
                { "Idempotency-Key": "outage" },
              )
            ).status,
            202,
          );
          assert.ok(
            (
              await db.query(
                "SELECT count(*)::int AS n FROM outbox WHERE status='PENDING'",
              )
            ).rows[0].n >= 1,
          );
        });
        await eventually(
          async () =>
            (
              await db.query(
                "SELECT count(*)::int AS n FROM outbox WHERE status='PENDING'",
              )
            ).rows[0].n === 0,
          60000,
        );
        // The database arbitrates payment vs expiration, including repeat expiry runs.
        await db.query(
          "UPDATE orders SET expires_at=now()+interval '100 milliseconds' WHERE id=$1",
          [order],
        );
        await sleep(150);
        const payment = await request(`/api/flash-sale/order/${order}/pay`, {});
        assert.equal(payment.status, 409);
        await eventually(
          async () =>
            (await db.query("SELECT status FROM orders WHERE id=$1", [order]))
              .rows[0].status === "CANCELLED",
        );
        const stock = (await db.query("SELECT stock FROM sales")).rows[0].stock;
        await sleep(650);
        assert.equal(
          (await db.query("SELECT stock FROM sales")).rows[0].stock,
          stock,
        );
        const other = (
          await db.query(
            "SELECT id FROM orders WHERE status='PENDING_PAYMENT' LIMIT 1",
          )
        ).rows[0].id;
        assert.equal(
          (await request(`/api/flash-sale/order/${other}/pay`, {})).data.status,
          "PAID",
        );
        assert.equal(
          (await request(`/api/flash-sale/order/${other}/pay`, {})).data.status,
          "PAID",
        );
        const racing = (
          await db.query(
            "SELECT id FROM orders WHERE status='PENDING_PAYMENT' LIMIT 1",
          )
        ).rows[0].id;
        await db.query(
          "UPDATE orders SET expires_at=now()+interval '30 milliseconds' WHERE id=$1",
          [racing],
        );
        const racingPay = await request(
          `/api/flash-sale/order/${racing}/pay`,
          {},
        );
        assert.ok([200, 409].includes(racingPay.status));
        await sleep(650);
        const state = (
          await db.query("SELECT status FROM orders WHERE id=$1", [racing])
        ).rows[0].status;
        assert.ok(["PAID", "CANCELLED"].includes(state));
        const invariant = (
          await db.query(
            "SELECT s.stock+(SELECT count(*) FROM orders WHERE sale_id=s.id AND status!='CANCELLED')=s.initial_stock AS valid FROM sales s",
          )
        ).rows[0].valid;
        assert.equal(invariant, true);
        await stop("postgres", async () => {
          assert.equal(
            (
              await request(
                "/api/flash-sale/buy",
                { userId: "buyer_4000" },
                { "Idempotency-Key": "db-down" },
                "http://localhost:3001",
              )
            ).status,
            503,
          );
          assert.equal(
            (
              await request(
                "/health/live",
                undefined,
                {},
                "http://localhost:3001",
              )
            ).status,
            200,
          );
        });
        await eventually(
          async () =>
            (
              await request(
                `/api/flash-sale/order/${order}`,
                undefined,
                {},
                "http://localhost:3001",
              )
            ).status === 200,
        );
        await stop("redis", async () => {
          const base = "http://localhost:3001";
          assert.equal(
            (
              await request(
                "/api/flash-sale/buy",
                { userId: "buyer_3000" },
                { "Idempotency-Key": "redis-down" },
                base,
              )
            ).status,
            503,
          );
          assert.equal(
            (await request("/health/live", undefined, {}, base)).status,
            200,
          );
        });
      }
      if (lab === "10") {
        await request(
          "/api/dependency/config",
          { delay: 600, fail: false },
          {},
          "http://localhost:3004",
        );
        const actual = await Promise.all(
          Array.from({ length: 30 }, () =>
            request("/api/resilient", undefined, {}, "http://localhost:3001"),
          ),
        );
        assert.ok(actual.some((r) => r.data.error === "BACKPRESSURE"));
        for (let i = 0; i < 4; i++)
          await request(
            "/api/resilient",
            undefined,
            {},
            "http://localhost:3001",
          );
        assert.equal(
          (
            await request(
              "/api/resilient",
              undefined,
              {},
              "http://localhost:3001",
            )
          ).data.error,
          "CIRCUIT_OPEN",
        );
        await request(
          "/api/dependency/config",
          { delay: 0, fail: false },
          {},
          "http://localhost:3004",
        );
        await sleep(2200);
        assert.equal(
          (
            await request(
              "/api/resilient",
              undefined,
              {},
              "http://localhost:3001",
            )
          ).status,
          200,
        );
      }
    } finally {
      await db.end();
      redis.disconnect();
    }
  },
);
