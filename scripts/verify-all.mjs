import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
mkdirSync("reports", { recursive: true });
const from = process.argv[2] || "00";
let results = [];
try {
  results = JSON.parse(
    readFileSync("reports/integration-results.json", "utf8"),
  ).filter((r) => r.lab < from && r.status === "PASS");
} catch {}
for (const lab of [
  "00",
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
].filter((lab) => lab >= from)) {
  const fd = openSync(`reports/integration-${lab}.log`, "w");
  const start = Date.now();
  let status = "PASS";
  console.log(`Checking real infrastructure lab ${lab}...`);
  function run(action, ...args) {
    return (
      spawnSync("node", ["scripts/lab.mjs", action, lab, ...args], {
        stdio: ["ignore", fd, fd],
        timeout: 300000,
      }).status === 0
    );
  }
  run("down", "--volumes");
  try {
    if (!run("up")) {
      status = "START_FAILED";
    } else if (!run("test")) {
      status = "TEST_FAILED";
    }
  } finally {
    if (status !== "PASS") run("compose", "logs", "--tail", "60");
    run("down", "--volumes");
    closeSync(fd);
  }
  results.push({
    lab,
    status,
    seconds: Math.round((Date.now() - start) / 100) / 10,
  });
  console.log(JSON.stringify(results.at(-1)));
  writeFileSync(
    "reports/integration-results.json",
    JSON.stringify(results, null, 2),
  );
  if (status !== "PASS") process.exit(1);
}
