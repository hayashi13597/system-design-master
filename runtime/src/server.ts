import express, { Request, Response, NextFunction } from "express";
import {
  db,
  redis,
  lab,
  needsRedis,
  registry,
  requestMiddleware,
  HttpError,
  log,
} from "./core";
import { lessonRoutes, closeLessons } from "./lessons";
import { capstoneRoutes, expireReservations } from "./capstone";
import {
  closeBroker,
  workerLoop,
  relayOnce,
  startRabbitConsumer,
  startKafkaConsumer,
  rabbit,
  kafkaProducer,
} from "./broker";

const role = process.env.ROLE || "api";
let stopping = false;
async function boot() {
  await db.query("SELECT 1");
  if (needsRedis) await redis.connect();
  if (role === "relay") {
    void workerLoop(relayOnce);
    return;
  }
  if (role === "expiry") {
    void workerLoop(expireReservations);
    return;
  }
  if (role === "consumer") {
    if (lab === "08") {
      while (!stopping) {
        try {
          await startKafkaConsumer();
          break;
        } catch (e) {
          log("kafka_retry", { message: String(e) });
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } else void workerLoop(startRabbitConsumer);
    return;
  }
  const app = express();
  app.use(requestMiddleware);
  app.use(express.json({ limit: "16kb" }));
  app.get("/health/live", (_req, res) =>
    res.status(stopping ? 503 : 200).json({ live: !stopping }),
  );
  app.get("/health/ready", async (_req, res) => {
    try {
      if (stopping) throw new Error("Stopping");
      await db.query("SELECT 1");
      if (needsRedis) await redis.ping();
      if (lab === "07") await rabbit();
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });
  app.get("/metrics", async (_req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });
  app.use(lab === "09" ? capstoneRoutes() : lessonRoutes());
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof HttpError
        ? err.status
        : err.type === "entity.parse.failed"
          ? 400
          : err.code === "23505"
            ? 409
            : err.code === "22P02"
              ? 400
              : 503;
    log("request_error", { status, message: err.message });
    res
      .status(status)
      .json({
        error:
          status === 503 && !(err instanceof HttpError)
            ? "DEPENDENCY_UNAVAILABLE"
            : err.message,
      });
  });
  const server = app.listen(Number(process.env.PORT || 3000), () =>
    log("listening", { role }),
  );
  process.on("SIGTERM", () => {
    stopping = true;
    server.close(() => void shutdown());
    setTimeout(() => process.exit(1), 8000).unref();
  });
  process.on("SIGINT", () => {
    stopping = true;
    server.close(() => void shutdown());
  });
}
async function shutdown() {
  await closeBroker().catch(() => {});
  await closeLessons();
  await db.end();
  redis.disconnect();
  process.exit(0);
}
if (role !== "api" && role !== "dependency")
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
      void shutdown();
    });
boot().catch((e) => {
  log("boot_error", { message: String(e) });
  process.exit(1);
});
