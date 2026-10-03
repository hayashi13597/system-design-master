import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
const lab = process.env.LAB;
const base = process.env.BASE_URL || "http://localhost:8080";
const count = Number(process.env.REQUESTS || 1000),
  concurrency = Number(process.env.CONCURRENCY || 30);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 100000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 1000
)
  throw new Error("Invalid REQUESTS/CONCURRENCY");
const paths = {
  "00": "/api/index/plan",
  "01": "/api/cpu-task",
  "02": "/api/products/1?mode=distributed",
  "03": "/api/limit/token-bucket",
  "04": "/api/profiles/user_1",
  "05": "/api/users",
  "06": "/api/info",
  "07": "/api/payments/balance",
  "08": "/api/outbox/status",
  "09": "/api/flash-sale/buy",
  10: "/api/resilient",
};
const latencies = [],
  statuses = {};
let next = 0,
  errors = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < count) {
      const i = next++;
      const start = performance.now();
      try {
        const response = await fetch(base + paths[lab], {
          method: lab === "09" ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body:
            lab === "09"
              ? JSON.stringify({ userId: `buyer_${i + 10000}` })
              : undefined,
          signal: AbortSignal.timeout(10000),
        });
        await response.arrayBuffer();
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (response.status >= 500) errors++;
      } catch {
        errors++;
        statuses.network = (statuses.network || 0) + 1;
      }
      latencies.push(performance.now() - start);
    }
  }),
);
const duration = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const p = (q) =>
  latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
const report = {
  timestamp: new Date().toISOString(),
  lab,
  base,
  requests: count,
  concurrency,
  durationSeconds: duration,
  requestsPerSecond: count / duration,
  errorRate: errors / count,
  statuses,
  latencyMs: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
  machine: {
    node: process.version,
    cpus: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  note: "Includes rejected responses; this is not proof of successful-order throughput or production capacity.",
};
await mkdir("reports", { recursive: true });
const file = `reports/benchmark-${lab}-${Date.now()}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, file }, null, 2));
