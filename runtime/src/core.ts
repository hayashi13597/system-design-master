import { Pool, PoolClient } from "pg";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export const lab = process.env.LAB || "";
if (!/^(00|01|02|03|04|05|06|07|08|09|10)$/.test(lab))
  throw new Error("LAB must be 00..10; use npm run lab:up -- 01");
if (!process.env.DB_URL)
  throw new Error("DB_URL is required; no in-memory fallback");
export const db = new Pool({
  connectionString: process.env.DB_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
db.on("error", (err) => log("db_pool_error", { message: err.message }));
export const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 1500,
  commandTimeout: 2000,
  enableOfflineQueue: false,
});
redis.on("error", (err) => log("redis_error", { message: err.message }));
export const needsRedis =
  ["01", "02", "03", "06", "09"].includes(lab) &&
  (!process.env.ROLE || process.env.ROLE === "api");
export const instance = process.env.INSTANCE_ID || "local";
export const registry = new Registry();
collectDefaultMetrics({ register: registry });
export const httpDuration = new Histogram({
  name: "lab_http_duration_seconds",
  help: "HTTP response duration",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});
export const dbQueries = new Counter({
  name: "lab_product_queries_total",
  help: "Product queries executed",
  registers: [registry],
});
if (lab === "09") {
  new Gauge({
    name: "lab_outbox_pending",
    help: "Outbox events waiting for relay",
    registers: [registry],
    async collect() {
      try {
        this.set(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM outbox WHERE status='PENDING'",
            )
          ).rows[0].n,
        );
      } catch {
        this.set(NaN);
      }
    },
  });
  new Gauge({
    name: "lab_inventory_stock",
    help: "Committed available inventory",
    registers: [registry],
    async collect() {
      try {
        this.set(
          (
            await db.query("SELECT stock FROM sales WHERE id=$1", [
              "ticket_vip_blackpink",
            ])
          ).rows[0].stock,
        );
      } catch {
        this.set(NaN);
      }
    },
  });
}
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      lab,
      instance,
      ...fields,
    }),
  );
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
export async function transaction<T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
export function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128)
    throw new HttpError(400, `Invalid ${field}`);
  return value;
}
export function requestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.get("X-Request-ID");
  const id =
    incoming && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader("X-Request-ID", id);
  res.setHeader("X-Instance-ID", instance);
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path || "unmatched";
    end({ method: req.method, route, status: String(res.statusCode) });
    log("request", {
      requestId: id,
      method: req.method,
      route,
      status: res.statusCode,
    });
  });
  next();
}
