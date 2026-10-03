import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import { asyncRoute, db, transaction, HttpError, text } from "./core";
import { limit } from "./rate-limit";

export const DEFAULT_ITEM = "ticket_vip_blackpink";
export async function reserve(
  userId: string,
  itemId: string,
  key: string,
  quantity = 1,
) {
  if (quantity !== 1) throw new HttpError(400, "quantity must equal 1");
  const hash = createHash("sha256")
    .update(JSON.stringify([userId, itemId, quantity]))
    .digest("hex");
  return transaction(async (c) => {
    // Serialize retries of the same key even across API nodes.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
    const previous = await c.query(
      "SELECT * FROM orders WHERE idempotency_key=$1",
      [key],
    );
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== hash)
        throw new HttpError(
          409,
          "Idempotency key reused with a different payload",
        );
      return { order: previous.rows[0], replay: true };
    }
    const stock = await c.query(
      "UPDATE sales SET stock=stock-1 WHERE id=$1 AND stock>0 RETURNING stock",
      [itemId],
    );
    if (!stock.rowCount) throw new HttpError(409, "OUT_OF_STOCK");
    const id = randomUUID();
    const order = await c.query(
      "INSERT INTO orders(id,sale_id,user_id,quantity,status,idempotency_key,request_hash,expires_at) VALUES ($1,$2,$3,1,'PENDING_PAYMENT',$4,$5,now()+$6*interval '1 second') RETURNING *",
      [
        id,
        itemId,
        userId,
        key,
        hash,
        Number(process.env.RESERVATION_TTL_SECONDS || 600),
      ],
    );
    await c.query(
      "INSERT INTO outbox(id,aggregate_id,event_type,payload) VALUES ($1,$2,'ORDER_RESERVED',$3)",
      [randomUUID(), id, { userId, itemId, quantity: 1 }],
    );
    return { order: order.rows[0], replay: false };
  });
}
export async function expireReservations() {
  return transaction(async (c) => {
    const expired = await c.query(
      "UPDATE orders SET status='CANCELLED' WHERE id IN (SELECT id FROM orders WHERE status='PENDING_PAYMENT' AND expires_at<=now() ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *",
    );
    for (const row of expired.rows) {
      await c.query("UPDATE sales SET stock=stock+1 WHERE id=$1", [
        row.sale_id,
      ]);
      await c.query(
        "INSERT INTO outbox(id,aggregate_id,event_type,payload) VALUES ($1,$2,'ORDER_CANCELLED',$3)",
        [randomUUID(), row.id, { userId: row.user_id, itemId: row.sale_id }],
      );
    }
    return expired.rowCount;
  });
}
export function capstoneRoutes() {
  const r = Router();
  r.post(
    "/api/flash-sale/buy",
    asyncRoute(async (req, res) => {
      const userId = text(req.body.userId, "userId");
      const itemId = text(req.body.itemId ?? DEFAULT_ITEM, "itemId");
      const key = text(req.get("Idempotency-Key"), "Idempotency-Key");
      const quantity = req.body.quantity ?? 1;
      if (quantity !== 1) throw new HttpError(400, "quantity must equal 1");
      // Demo fixture identity, deliberately not a production authentication scheme.
      if (!/^buyer_\d+$/.test(userId))
        throw new HttpError(400, "Use a fixture user buyer_<number>");
      const rate = await limit(userId, 5, 1000);
      res.set("X-RateLimit-Remaining", String(rate.remaining));
      if (!rate.allowed) {
        res.set("Retry-After", String(rate.retryAfter));
        throw new HttpError(429, "TOO_MANY_REQUESTS");
      }
      const { order, replay } = await reserve(userId, itemId, key, quantity);
      res
        .status(replay ? 200 : 202)
        .json({ orderId: order.id, status: order.status, replay });
    }),
  );
  r.get(
    "/api/flash-sale/product/:itemId",
    asyncRoute(async (req, res) => {
      const result = await db.query("SELECT * FROM sales WHERE id=$1", [
        req.params.itemId,
      ]);
      if (!result.rowCount) throw new HttpError(404, "Product not found");
      res.json(result.rows[0]);
    }),
  );
  r.get(
    "/api/flash-sale/order/:orderId",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(req.params.orderId)))
        throw new HttpError(404, "Order not found");
      const result = await db.query("SELECT * FROM orders WHERE id=$1", [
        req.params.orderId,
      ]);
      if (!result.rowCount) throw new HttpError(404, "Order not found");
      res.json(result.rows[0]);
    }),
  );
  r.post(
    "/api/flash-sale/order/:orderId/pay",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(req.params.orderId)))
        throw new HttpError(404, "Order not found");
      const result = await transaction(async (c) => {
        const paid = await c.query(
          "UPDATE orders SET status='PAID' WHERE id=$1 AND status='PENDING_PAYMENT' AND expires_at>now() RETURNING *",
          [req.params.orderId],
        );
        if (paid.rowCount) {
          await c.query(
            "INSERT INTO outbox(id,aggregate_id,event_type,payload) VALUES ($1,$2,'ORDER_PAID',$3)",
            [randomUUID(), req.params.orderId, { simulatedPayment: true }],
          );
          return paid.rows[0];
        }
        const existing = await c.query("SELECT * FROM orders WHERE id=$1", [
          req.params.orderId,
        ]);
        if (!existing.rowCount) throw new HttpError(404, "Order not found");
        if (existing.rows[0].status === "PAID") return existing.rows[0];
        throw new HttpError(409, "Reservation expired or cancelled");
      });
      res.json(result);
    }),
  );
  r.get(
    "/api/system/status",
    asyncRoute(async (_req, res) => {
      // One SQL statement sees a single MVCC snapshot.
      const result = await db.query(
        `SELECT
   (SELECT stock FROM sales WHERE id=$1) AS stock,
   (SELECT count(*)::int FROM orders WHERE status!='CANCELLED') AS active_orders,
   (SELECT count(*)::int FROM orders) AS total_orders,
   (SELECT count(*)::int FROM outbox WHERE status='PENDING') AS pending_events,
   (SELECT count(*)::int FROM deliveries) AS deliveries`,
        [DEFAULT_ITEM],
      );
      res.json(result.rows[0]);
    }),
  );
  return r;
}
