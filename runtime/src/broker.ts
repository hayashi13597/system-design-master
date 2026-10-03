import amqp, {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import { Kafka, Producer, Consumer, logLevel } from "kafkajs";
import { transaction, lab, log } from "./core";
let connection: ChannelModel | undefined;
let publisher: ConfirmChannel | undefined;
let rabbitConnecting: Promise<ConfirmChannel> | undefined;
let consumerChannel: Channel | undefined;
let producer: Producer | undefined;
let consumer: Consumer | undefined;
let stopping = false;
export const queue = "lab.events";
export async function rabbit(): Promise<ConfirmChannel> {
  if (publisher) return publisher;
  if (!rabbitConnecting)
    rabbitConnecting = connectRabbit().finally(() => {
      rabbitConnecting = undefined;
    });
  return rabbitConnecting;
}
async function connectRabbit(): Promise<ConfirmChannel> {
  const conn = await amqp.connect(process.env.RABBIT_URL || "amqp://rabbitmq", {
    timeout: 2000,
  });
  connection = conn;
  conn.on("error", (e) => log("rabbit_error", { message: e.message }));
  conn.on("close", () => {
    if (connection === conn) {
      publisher = undefined;
      connection = undefined;
      consumerChannel = undefined;
    }
  });
  const ch = await conn.createConfirmChannel();
  await ch.assertQueue("lab.dlq", { durable: true });
  await ch.assertQueue(queue, { durable: true });
  await ch.assertQueue("lab.retry", {
    durable: true,
    arguments: {
      "x-message-ttl": 300,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": queue,
    },
  });
  ch.on("error", (e) => log("rabbit_channel_error", { message: e.message }));
  ch.on("close", () => {
    if (publisher === ch) publisher = undefined;
  });
  publisher = ch;
  return ch;
}
function confirmedSend(
  ch: ConfirmChannel,
  name: string,
  body: Buffer,
  options: amqp.Options.Publish,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Publisher confirm timeout"));
      void ch.close().catch(() => {});
    }, 3000);
    try {
      ch.sendToQueue(name, body, options, (err) => {
        clearTimeout(timer);
        err ? reject(err) : resolve();
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
export async function publish(payload: unknown) {
  const ch = await rabbit();
  await confirmedSend(ch, queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
}
export async function kafkaProducer() {
  if (producer) return producer;
  const kafka = new Kafka({
    clientId: "lab-outbox",
    brokers: [process.env.KAFKA_BROKERS || "redpanda:9092"],
    logLevel: logLevel.ERROR,
    retry: { retries: 2 },
  });
  const p = kafka.producer();
  await p.connect();
  producer = p;
  return p;
}
export async function relayOnce() {
  // Hold a row lock through broker confirmation. A crash after publish duplicates the event, safely.
  return transaction(async (c) => {
    const rows = await c.query(
      "SELECT * FROM outbox WHERE status='PENDING' ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows.rows) {
      const payload = {
        ...row.payload,
        eventId: row.id,
        orderId: row.aggregate_id,
        eventType: row.event_type,
      };
      if (lab === "08")
        await (
          await kafkaProducer()
        ).send({
          topic: "order-events",
          messages: [{ key: row.aggregate_id, value: JSON.stringify(payload) }],
        });
      else await publish(payload);
      if (process.env.CRASH_AFTER_PUBLISH === "1") process.exit(86);
      await c.query(
        "UPDATE outbox SET status='PROCESSED',processed_at=now() WHERE id=$1",
        [row.id],
      );
    }
    return rows.rowCount;
  });
}
export async function consumePayload(payload: any) {
  if (payload.poison || payload.isPoison) throw new Error("Poison message");
  const key = payload.eventId || payload.idempotencyKey;
  if (typeof key !== "string" || !key) throw new Error("Missing event key");
  await transaction(async (c) => {
    const inserted = await c.query(
      "INSERT INTO processed_messages(id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id",
      [key],
    );
    if (!inserted.rowCount) return;
    if (payload.amount !== undefined) {
      if (!Number.isSafeInteger(payload.amount) || payload.amount <= 0)
        throw new Error("Invalid amount");
      await c.query("UPDATE accounts SET balance=balance+$1 WHERE id='demo'", [
        payload.amount,
      ]);
    } else
      await c.query(
        "INSERT INTO deliveries(event_id,order_id,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [key, payload.orderId, payload],
      );
  });
}
export async function startRabbitConsumer() {
  const pub = await rabbit();
  if (consumerChannel) return;
  const ch = await connection!.createChannel();
  consumerChannel = ch;
  ch.on("error", (e) => log("consumer_channel_error", { message: e.message }));
  ch.on("close", () => {
    if (consumerChannel === ch) consumerChannel = undefined;
  });
  await ch.prefetch(4);
  await ch.consume(
    queue,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        await consumePayload(JSON.parse(msg.content.toString()));
        if (process.env.CRASH_BEFORE_ACK === "1") process.exit(87);
        ch.ack(msg);
      } catch (err) {
        const retries = Number(msg.properties.headers?.attempt || 0);
        try {
          await confirmedSend(
            pub,
            retries >= 2 ? "lab.dlq" : "lab.retry",
            msg.content,
            { persistent: true, headers: { attempt: retries + 1 } },
          );
          ch.ack(msg);
        } catch {
          try {
            ch.nack(msg, false, true);
          } catch {
            /* Closed channel returns unacked message to broker. */
          }
        }
        log("consumer_failure", { message: String(err), retries });
      }
    },
    { noAck: false },
  );
}
export async function startKafkaConsumer() {
  const kafka = new Kafka({
    clientId: "lab-consumer",
    brokers: [process.env.KAFKA_BROKERS || "redpanda:9092"],
    logLevel: logLevel.ERROR,
    retry: { retries: 2 },
  });
  const c = kafka.consumer({ groupId: "lab-deliveries" });
  await c.connect();
  await c.subscribe({ topic: "order-events", fromBeginning: true });
  consumer = c;
  await c.run({
    eachMessage: async ({ message }) => {
      await consumePayload(JSON.parse(message.value!.toString()));
      if (process.env.CRASH_BEFORE_ACK === "1") process.exit(87);
    },
  });
}
export async function closeBroker() {
  stopping = true;
  await consumer?.disconnect();
  await producer?.disconnect();
  await connection?.close();
}
export async function workerLoop(fn: () => Promise<unknown>) {
  while (!stopping) {
    try {
      await fn();
    } catch (e) {
      log("worker_retry", { message: String(e) });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
