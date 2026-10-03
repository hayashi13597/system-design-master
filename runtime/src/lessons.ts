import { Router } from "express";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import {
  asyncRoute,
  db,
  redis,
  lab,
  HttpError,
  text,
  instance,
  transaction,
} from "./core";
import { getProduct } from "./cache";
import { limit } from "./rate-limit";
import { publish, consumePayload } from "./broker";
import { createUser, getUser, shards } from "./sharding";
const replicas =
  lab === "04"
    ? [1, 2].map(
        (n) =>
          new Pool({
            connectionString: `postgres://postgres:lab_password@replica${n}:5432/lab`,
            connectionTimeoutMillis: 1500,
            statement_timeout: 2000,
            max: 3,
          }),
      )
    : [];
export async function closeLessons() {
  await Promise.all([...replicas, ...shards.values()].map((p) => p.end()));
}
let localCounter = 0;
let naiveCounter = 0;
let replicaIndex = 0;
let unsafeStock = 50;
let breakerFailures = 0,
  breakerUntil = 0,
  inFlight = 0;
let halfOpen = false;
let dependency = { delay: 0, fail: false };
const pinning = 5005;
export function lessonRoutes() {
  const r = Router();
  r.get("/api/info", (_req, res) =>
    res.json({ lab, instance, pid: process.pid }),
  );
  if (lab === "00") {
    r.get(
      "/api/index/plan",
      asyncRoute(async (_req, res) =>
        res.json(
          (
            await db.query(
              "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM foundation_items WHERE category=42",
            )
          ).rows,
        ),
      ),
    );
    r.post(
      "/api/index/create",
      asyncRoute(async (_req, res) => {
        await db.query(
          "CREATE INDEX IF NOT EXISTS foundation_category ON foundation_items(category)",
        );
        res.json({ indexed: true });
      }),
    );
    r.post(
      "/api/isolation/:mode",
      asyncRoute(async (req, res) => {
        if (req.params.mode === "unsafe") {
          const v = (
            await db.query("SELECT balance FROM accounts WHERE id='demo'")
          ).rows[0].balance;
          await new Promise((r) => setTimeout(r, 40));
          await db.query("UPDATE accounts SET balance=$1 WHERE id='demo'", [
            Number(v) + 1,
          ]);
        } else if (req.params.mode === "atomic")
          await db.query(
            "UPDATE accounts SET balance=balance+1 WHERE id='demo'",
          );
        else throw new HttpError(400, "mode must be unsafe or atomic");
        res.json({ ok: true });
      }),
    );
    r.get(
      "/api/isolation/balance",
      asyncRoute(async (_req, res) =>
        res.json(
          (await db.query("SELECT * FROM accounts WHERE id='demo'")).rows[0],
        ),
      ),
    );
  }
  if (lab === "01") {
    r.post("/api/stateful/increment", (_req, res) =>
      res.json({ instance, counter: ++localCounter }),
    );
    r.post(
      "/api/shared/increment",
      asyncRoute(async (_req, res) =>
        res.json({ instance, counter: await redis.incr("shared-counter") }),
      ),
    );
    r.get("/api/cpu-task", (_req, res) => {
      let sum = 0;
      for (let i = 0; i < 200000; i++) sum += Math.sqrt(i) * Math.sin(i);
      res.json({ instance, sum });
    });
  }
  if (lab === "02") {
    r.get(
      "/api/products/:id",
      asyncRoute(async (req, res) => {
        const product = await getProduct(
          String(req.params.id),
          String(req.query.mode || "distributed"),
        );
        res.status(product ? 200 : 404).json({ product });
      }),
    );
    r.put(
      "/api/products/:id",
      asyncRoute(async (req, res) => {
        const name = text(req.body.name, "name");
        const row = await db.query(
          "UPDATE products SET name=$1,version=version+1 WHERE id=$2 RETURNING *",
          [name, req.params.id],
        );
        if (!row.rowCount) throw new HttpError(404, "Product not found");
        await redis.del(`product:${req.params.id}`);
        res.json(row.rows[0]);
      }),
    );
    r.get(
      "/api/cache/stats",
      asyncRoute(async (_req, res) =>
        res.json(
          (await db.query("SELECT count::int FROM query_stats")).rows[0],
        ),
      ),
    );
  }
  if (lab === "03") {
    r.get(
      "/api/limit/:mode",
      asyncRoute(async (req, res) => {
        const mode = String(req.params.mode);
        const key = text(req.get("X-User-ID") || "demo", "X-User-ID");
        if (mode === "unsafe") {
          const old = await redis.get(`unsafe-quota:${key}`);
          await new Promise((r) => setTimeout(r, 10));
          if (Number(old) >= 25) {
            res.status(429).json({ allowed: false });
            return;
          }
          await redis.set(`unsafe-quota:${key}`, Number(old) + 1, "PX", 1000);
          res.json({ allowed: true });
          return;
        }
        if (!["token-bucket", "sliding"].includes(mode))
          throw new HttpError(400, "Unknown rate limiter");
        const result = await limit(key, 25, 1000, mode);
        res.set({
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": String(result.remaining),
        });
        if (!result.allowed) res.set("Retry-After", String(result.retryAfter));
        res.status(result.allowed ? 200 : 429).json(result);
      }),
    );
  }
  if (lab === "04") {
    r.post(
      "/api/profiles/:id",
      asyncRoute(async (req, res) => {
        const bio = text(req.body.bio, "bio");
        const result = await transaction((c) =>
          c.query(
            "UPDATE profiles SET bio=$1,version=version+1 WHERE id=$2 RETURNING *",
            [bio, req.params.id],
          ),
        );
        if (!result.rowCount) throw new HttpError(404, "Profile not found");
        // A primary WAL position obtained after COMMIT includes this transaction.
        const lsn = (await db.query("SELECT pg_current_wal_lsn()::text AS lsn"))
          .rows[0].lsn;
        res.json({ ...result.rows[0], lsn });
      }),
    );
    r.get(
      "/api/profiles/:id",
      asyncRoute(async (req, res) => {
        const lsn = req.get("X-Min-LSN");
        if (lsn && !/^[0-9A-F]+\/[0-9A-F]+$/i.test(lsn))
          throw new HttpError(400, "Invalid WAL LSN");
        const replica = replicas[replicaIndex++ % replicas.length];
        let pool: Pool = replica;
        let servedBy = `replica${((replicaIndex - 1) % 2) + 1}`;
        if (lsn) {
          try {
            const replay = (
              await replica.query(
                "SELECT COALESCE(pg_last_wal_replay_lsn()>=$1::pg_lsn,false) AS caught_up",
                [lsn],
              )
            ).rows[0];
            if (!replay.caught_up) {
              pool = db;
              servedBy = "primary";
            }
          } catch {
            pool = db;
            servedBy = "primary";
          }
        }
        const row = (
          await pool.query("SELECT * FROM profiles WHERE id=$1", [
            req.params.id,
          ])
        ).rows[0];
        if (!row) throw new HttpError(404, "Profile not found");
        res.json({ ...row, servedBy });
      }),
    );
  }
  if (lab === "05") {
    r.post(
      "/api/users",
      asyncRoute(async (req, res) =>
        res
          .status(201)
          .json(
            await createUser(
              text(req.body.name, "name"),
              text(req.body.email, "email"),
            ),
          ),
      ),
    );
    r.get(
      "/api/users/:id",
      asyncRoute(async (req, res) => {
        const result = await getUser(String(req.params.id));
        res.status(result.user ? 200 : 404).json(result);
      }),
    );
    r.get(
      "/api/users",
      asyncRoute(async (_req, res) => {
        const result = await transaction(async (c) => {
          await c.query(`SELECT pg_advisory_xact_lock_shared(${pinning})`);
          const config = (await c.query("SELECT * FROM routing")).rows[0];
          if (config.state !== "ACTIVE")
            throw new HttpError(503, "Maintenance");
          const rows = await Promise.all(
            config.nodes.map((n: string) =>
              shards.get(n)!.query("SELECT * FROM users"),
            ),
          );
          return {
            users: rows.flatMap((r: any) => r.rows),
            shards: config.nodes,
          };
        });
        res.json(result);
      }),
    );
  }
  if (lab === "06") {
    r.post(
      "/api/lock/acquire",
      asyncRoute(async (req, res) => {
        const token = randomUUID();
        const fence = (
          await db.query("SELECT nextval('fencing_seq')::text AS fence")
        ).rows[0].fence;
        const ok = await redis.set("inventory-lock", token, "PX", 500, "NX");
        res
          .status(ok ? 201 : 409)
          .json(ok ? { token, fence } : { error: "LOCK_BUSY" });
      }),
    );
    r.post(
      "/api/lock/release",
      asyncRoute(async (req, res) => {
        const token = text(req.body.token, "token");
        const deleted = await redis.eval(
          "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
          1,
          "inventory-lock",
          token,
        );
        res.json({ released: deleted === 1 });
      }),
    );
    r.post(
      "/api/inventory/deduct",
      asyncRoute(async (req, res) => {
        const fence = text(req.body.fence, "fence");
        const token = text(req.body.token, "token");
        if (!/^\d+$/.test(fence)) throw new HttpError(400, "Invalid fence");
        if ((await redis.get("inventory-lock")) !== token)
          throw new HttpError(409, "Lease expired");
        const row = await db.query(
          "UPDATE lock_inventory SET stock=stock-1,fence=$1 WHERE id='demo' AND stock>0 AND fence<$1 RETURNING *",
          [fence],
        );
        if (!row.rowCount)
          throw new HttpError(409, "Stale fencing token or sold out");
        res.json(row.rows[0]);
      }),
    );
    r.post(
      "/api/inventory/unsafe",
      asyncRoute(async (_req, res) => {
        const old = unsafeStock;
        await new Promise((r) => setTimeout(r, 10));
        unsafeStock = old - 1;
        res.json({ stock: unsafeStock, unsafe: true });
      }),
    );
  }
  if (lab === "07") {
    r.post(
      "/api/payments",
      asyncRoute(async (req, res) => {
        const key = text(req.body.idempotencyKey, "idempotencyKey");
        const amount = req.body.amount;
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw new HttpError(400, "amount must be a positive integer");
        await publish({
          idempotencyKey: key,
          amount,
          poison: req.body.poison === true,
        });
        res.status(202).json({ idempotencyKey: key });
      }),
    );
    r.get(
      "/api/payments/balance",
      asyncRoute(async (_req, res) =>
        res.json(
          (await db.query("SELECT balance::int FROM accounts WHERE id='demo'"))
            .rows[0],
        ),
      ),
    );
  }
  if (lab === "08") {
    r.post(
      "/api/orders",
      asyncRoute(async (req, res) => {
        const userId = text(req.body.userId, "userId");
        const key = text(req.get("Idempotency-Key"), "Idempotency-Key");
        const result = await transaction(async (c) => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [key],
          );
          const existing = await c.query(
            "SELECT * FROM orders WHERE idempotency_key=$1",
            [key],
          );
          if (existing.rowCount) {
            if (existing.rows[0].user_id !== userId)
              throw new HttpError(409, "Payload mismatch");
            return existing.rows[0];
          }
          const id = randomUUID();
          const order = await c.query(
            "INSERT INTO orders(id,sale_id,user_id,quantity,status,idempotency_key,request_hash,expires_at) VALUES ($1,'ticket_vip_blackpink',$2,1,'PENDING_PAYMENT',$3,$2,now()+interval '10 minutes') RETURNING *",
            [id, userId, key],
          );
          await c.query(
            "INSERT INTO outbox(id,aggregate_id,event_type,payload) VALUES ($1,$2,'ORDER_CREATED',$3)",
            [randomUUID(), id, { userId }],
          );
          return order.rows[0];
        });
        res.status(202).json(result);
      }),
    );
    r.get(
      "/api/outbox/status",
      asyncRoute(async (_req, res) =>
        res.json(
          (
            await db.query(
              "SELECT (SELECT count(*)::int FROM orders) AS orders,(SELECT count(*)::int FROM outbox WHERE status='PENDING') AS pending,(SELECT count(*)::int FROM deliveries) AS delivered",
            )
          ).rows[0],
        ),
      ),
    );
  }
  if (lab === "10") {
    r.post(
      "/api/dependency/config",
      asyncRoute(async (req, res) => {
        if (process.env.ROLE !== "dependency")
          throw new HttpError(404, "Dependency only");
        if (
          !Number.isInteger(req.body.delay) ||
          req.body.delay < 0 ||
          req.body.delay > 10000 ||
          typeof req.body.fail !== "boolean"
        )
          throw new HttpError(400, "Invalid configuration");
        dependency = req.body;
        res.json(dependency);
      }),
    );
    r.get(
      "/api/dependency",
      asyncRoute(async (_req, res) => {
        await new Promise((r) => setTimeout(r, dependency.delay));
        res.status(dependency.fail ? 503 : 200).json({ ok: !dependency.fail });
      }),
    );
    r.get(
      "/api/resilient",
      asyncRoute(async (_req, res) => {
        if (inFlight >= 4) throw new HttpError(503, "BACKPRESSURE");
        if (Date.now() < breakerUntil) throw new HttpError(503, "CIRCUIT_OPEN");
        if (breakerFailures >= 3 && halfOpen)
          throw new HttpError(503, "HALF_OPEN_BUSY");
        const probe = breakerFailures >= 3;
        if (probe) halfOpen = true;
        inFlight++;
        try {
          let error: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await fetch(
                "http://dependency:3000/api/dependency",
                { signal: AbortSignal.timeout(200) },
              );
              if (!response.ok)
                throw new Error(`dependency ${response.status}`);
              breakerFailures = 0;
              breakerUntil = 0;
              res.json({ ok: true, attempts: attempt + 1 });
              return;
            } catch (e) {
              error = e;
              if (attempt === 0)
                await new Promise((r) =>
                  setTimeout(r, 30 + Math.random() * 40),
                );
            }
          }
          breakerFailures++;
          if (breakerFailures >= 3) breakerUntil = Date.now() + 2000;
          throw new HttpError(503, `DEPENDENCY_UNAVAILABLE: ${String(error)}`);
        } finally {
          inFlight--;
          if (probe) halfOpen = false;
        }
      }),
    );
  }
  return r;
}
