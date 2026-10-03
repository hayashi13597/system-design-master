import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = {
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
  10: "module-10-reliability",
};
const [action, raw, ...extra] = process.argv.slice(2);
const lab = raw?.padStart(2, "0");
if (
  !dirs[lab] ||
  !["up", "down", "test", "benchmark", "reset", "compose", "reshard"].includes(
    action,
  )
) {
  console.error(
    "Usage: npm run lab:<up|down|test|benchmark|reset> -- <00..10> [options]",
  );
  process.exit(1);
}
const compose = [
  "compose",
  "-f",
  path.join(root, "labs", dirs[lab], "docker-compose.yml"),
];
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const env = {
  LAB: lab,
  DB_URL: "postgres://postgres:lab_password@localhost:55432/lab",
  REDIS_URL: "redis://localhost:56379",
  RABBIT_URL: "amqp://lab:lab_password@localhost:55672",
  KAFKA_BROKERS: "localhost:19092",
};
if (action === "up")
  run("docker", [
    ...compose,
    "up",
    "-d",
    "--build",
    "--wait",
    "--wait-timeout",
    "180",
    ...extra,
  ]);
if (action === "down")
  run("docker", [...compose, "--profile", "*", "down", ...extra]);
if (action === "compose") run("docker", [...compose, ...extra]);
if (action === "test") run("npm", ["run", "test:integration"], env);
if (action === "benchmark")
  run("node", ["scripts/benchmark.mjs", ...extra], env);
if (action === "reset") {
  // Reset only this lab's named volumes; explicit command is destructive by design.
  console.log(`Deleting lab ${lab} data volumes and reinitializing fixtures.`);
  run("docker", [...compose, "--profile", "*", "down", "-v"]);
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "180"]);
}
if (action === "reshard") {
  if (lab !== "05") throw new Error("Reshard is only for lab 05");
  run("docker", [
    ...compose,
    "--profile",
    "reshard",
    "up",
    "-d",
    "--wait",
    "shard4",
  ]);
  run("docker", [
    ...compose,
    "exec",
    "app-1",
    "node",
    "-e",
    "const {reshard,shards}=require('./dist/sharding');const {db}=require('./dist/core');reshard().then(console.log).then(()=>Promise.all([db.end(),...Array.from(shards.values()).map(p=>p.end())])).catch(e=>{console.error(e);process.exit(1)})",
  ]);
}
