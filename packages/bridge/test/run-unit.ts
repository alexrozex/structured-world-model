/**
 * Runs all bridge unit tests sequentially and reports overall results.
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const testDir = resolve(import.meta.dirname!, ".");
const testFiles = readdirSync(testDir).filter(
  (f) => f.endsWith(".test.ts") && f !== "run-unit.ts",
);

let totalPassed = 0;
let totalFailed = 0;

for (const file of testFiles) {
  const path = join(testDir, file);
  console.log(`\n━━━ Running ${file} ━━━\n`);
  try {
    const output = execSync(`npx tsx ${path}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log(output);

    const match = output.match(/(\d+)\/(\d+) passed/);
    if (match) {
      const p = parseInt(match[1]);
      const t = parseInt(match[2]);
      totalPassed += p;
      totalFailed += t - p;
    }
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    if (execErr.stdout) console.log(execErr.stdout);
    if (execErr.stderr) console.error(execErr.stderr);
    totalFailed++;
  }
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
const color = totalFailed === 0 ? "\x1b[32m" : "\x1b[31m";
console.log(
  `${color}TOTAL: ${totalPassed}/${totalPassed + totalFailed} unit tests passed\x1b[0m`,
);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (totalFailed > 0) process.exit(1);
