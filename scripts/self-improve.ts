#!/usr/bin/env npx tsx
/**
 * Recursive Self-Improvement Engine
 *
 * Each cycle:
 * 1. AUDIT — Run tests, typecheck, extract world model of own codebase, measure quality
 * 2. IDENTIFY — Analyze audit results, find highest-impact improvement
 * 3. EXECUTE — Implement the improvement
 * 4. VERIFY — Run tests + typecheck, ensure no regressions
 * 5. COMMIT — Push if verified
 * 6. CONVERGE CHECK — Compare quality before/after, stop if ceiling reached
 *
 * The system improves itself by using its own extraction capabilities
 * to understand its own codebase, then targeting the weakest points.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname!, "..");
const CORE = join(ROOT, "packages/core");
const STATE_FILE = join(ROOT, ".self-improve/state.json");
const LOG_DIR = join(ROOT, ".self-improve/logs");

interface CycleState {
  cycle: number;
  lastScore: number;
  lastTestCount: number;
  improvements: string[];
  staleCount: number; // consecutive cycles with no improvement
  startedAt: string;
  lastRunAt: string;
}

function ensureDirs() {
  const dir = join(ROOT, ".self-improve");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function loadState(): CycleState {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return {
    cycle: 0,
    lastScore: 0,
    lastTestCount: 0,
    improvements: [],
    staleCount: 0,
    startedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
  };
}

function saveState(state: CycleState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, {
      cwd: cwd ?? CORE,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env },
    }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? e.message;
  }
}

function log(msg: string) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─── AUDIT PHASE ────────────────────────────────────────────────

interface AuditResult {
  testsPass: boolean;
  testCount: number;
  typecheckClean: boolean;
  todoCount: number;
  fixmeCount: number;
  fileCount: number;
  exportCount: number;
  weakPoints: string[];
}

function audit(): AuditResult {
  log("AUDIT: Running tests...");
  const testOutput = run("pnpm test", ROOT);
  const testMatch = testOutput.match(/(\d+)\/(\d+) unit tests passed/);
  const testCount = testMatch ? parseInt(testMatch[1]) : 0;
  const testsPass = testMatch ? testMatch[1] === testMatch[2] : false;

  log("AUDIT: Running typecheck...");
  const tcOutput = run("pnpm --filter @swm/core typecheck", ROOT);
  const typecheckClean = !tcOutput.includes("error TS");

  log("AUDIT: Scanning codebase...");
  const todoCount = parseInt(
    run(
      "grep -r 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' -c 2>/dev/null || echo 0",
    ) || "0",
  );
  const fileCount = parseInt(run("find src -name '*.ts' | wc -l") || "0");
  const exportCount = parseInt(
    run("grep -r '^export ' src/index.ts | wc -l") || "0",
  );

  // Identify weak points
  const weakPoints: string[] = [];

  // Check for files without tests
  const srcFiles = run(
    "find src -name '*.ts' -not -name '*.test.ts' -not -path '*/index.ts'",
  )
    .split("\n")
    .filter(Boolean);
  const testFiles = run("find test -name '*.test.ts'")
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace("test/unit/", "").replace(".test.ts", ""));

  for (const src of srcFiles) {
    const base = src.replace("src/", "").replace(/\//g, "-").replace(".ts", "");
    if (!testFiles.some((t) => t.includes(base.split("-").pop()!))) {
      weakPoints.push(`Missing tests for: ${src}`);
    }
  }

  // Check for weak descriptions in schemas
  const schemaOutput = run("grep -c 'describe(' src/schema/world-model.ts");
  if (parseInt(schemaOutput) < 15) {
    weakPoints.push("Schema descriptions could be more comprehensive");
  }

  // Check export surface completeness
  if (exportCount < 20) {
    weakPoints.push(
      `Only ${exportCount} public API exports — consider exposing more utilities`,
    );
  }

  // Check for any skipped/incomplete features
  const emptyFunctions = run(
    "grep -n 'TODO\\|throw new Error.*not implemented' src/**/*.ts 2>/dev/null || echo ''",
  );
  if (emptyFunctions) {
    weakPoints.push(
      "Unimplemented functions found: " + emptyFunctions.slice(0, 200),
    );
  }

  log(
    `AUDIT: ${testCount} tests, ${todoCount} TODOs, ${weakPoints.length} weak points`,
  );

  return {
    testsPass,
    testCount,
    typecheckClean,
    todoCount,
    fixmeCount: 0,
    fileCount,
    exportCount,
    weakPoints,
  };
}

// ─── IDENTIFY PHASE ─────────────────────────────────────────────

interface ImprovementTask {
  id: string;
  description: string;
  category: "test" | "feature" | "quality" | "perf" | "docs";
  files: string[];
  priority: number; // 1=highest
}

function identify(
  auditResult: AuditResult,
  state: CycleState,
): ImprovementTask | null {
  const tasks: ImprovementTask[] = [];

  // Generate tasks from weak points
  for (const wp of auditResult.weakPoints) {
    if (wp.startsWith("Missing tests for:")) {
      const file = wp.replace("Missing tests for: ", "");
      tasks.push({
        id: `test-${file.replace(/[\/\.]/g, "-")}`,
        description: `Add unit tests for ${file}`,
        category: "test",
        files: [file],
        priority: 2,
      });
    }
  }

  // Always-available improvement tasks (prioritized)
  const standardTasks: ImprovementTask[] = [
    {
      id: "e2e-multipass",
      description:
        "Add E2E test for multi-pass extraction verifying second pass finds more entities",
      category: "test",
      files: ["test/proof.ts"],
      priority: 1,
    },
    {
      id: "e2e-code-extraction",
      description:
        "Add E2E test extracting from a real TypeScript file and verifying relation density",
      category: "test",
      files: ["test/proof.ts"],
      priority: 1,
    },
    {
      id: "validate-relation-density",
      description:
        "Add validation check: warn if relation count < entity count (indicates sparse extraction)",
      category: "quality",
      files: ["src/agents/validation.ts", "test/unit/validation.test.ts"],
      priority: 2,
    },
    {
      id: "export-dot-improved",
      description:
        "Improve DOT export with entity type coloring, constraint annotations, and process subgraphs",
      category: "feature",
      files: ["src/utils/graph.ts", "test/unit/graph.test.ts"],
      priority: 3,
    },
    {
      id: "query-explain",
      description:
        "Add --explain flag to query command showing which graph pattern matched and why",
      category: "feature",
      files: ["src/agents/query.ts", "src/cli.ts"],
      priority: 3,
    },
    {
      id: "refine-delta-report",
      description:
        "Make refine command show what changed (entities added, relations added) not just the full model",
      category: "feature",
      files: ["src/agents/refinement.ts", "src/cli.ts"],
      priority: 3,
    },
    {
      id: "constraint-severity-scoring",
      description:
        "Weight quality score by constraint severity — hard constraint violations reduce score more",
      category: "quality",
      files: ["src/agents/validation.ts", "test/unit/validation.test.ts"],
      priority: 2,
    },
    {
      id: "extraction-retry-logging",
      description:
        "Log extraction retries and failures to extraction_notes for transparency",
      category: "quality",
      files: ["src/swm.ts"],
      priority: 4,
    },
    {
      id: "mcp-search-tool",
      description:
        "Add search tool to MCP server for full-text search across entities, processes, constraints",
      category: "feature",
      files: ["src/serve/mcp-server.ts"],
      priority: 3,
    },
    {
      id: "compare-deep",
      description:
        "Enhance compare to detect process step differences, not just entity/relation mismatches",
      category: "feature",
      files: ["src/utils/compare.ts", "test/unit/compare.test.ts"],
      priority: 3,
    },
  ];

  tasks.push(...standardTasks);

  // Filter out already-completed improvements
  const remaining = tasks.filter((t) => !state.improvements.includes(t.id));

  if (remaining.length === 0) return null;

  // Sort by priority
  remaining.sort((a, b) => a.priority - b.priority);

  return remaining[0];
}

// ─── MAIN LOOP ──────────────────────────────────────────────────

async function main() {
  ensureDirs();
  const state = loadState();

  log(`═══ SELF-IMPROVEMENT CYCLE ${state.cycle + 1} ═══`);
  log(
    `Previous: ${state.lastTestCount} tests, ${state.improvements.length} improvements, ${state.staleCount} stale cycles`,
  );

  // Pull latest
  log("Pulling latest...");
  run("git pull origin feat/unified-monorepo", ROOT);

  // AUDIT
  const auditResult = audit();

  if (!auditResult.testsPass) {
    log("ERROR: Tests failing before improvement. Aborting cycle.");
    process.exit(1);
  }

  // IDENTIFY
  const task = identify(auditResult, state);

  if (!task) {
    log("CEILING REACHED: No more improvement tasks available.");
    log(
      `Final state: ${auditResult.testCount} tests, ${state.improvements.length} improvements completed.`,
    );
    saveState({ ...state, lastRunAt: new Date().toISOString() });
    process.exit(0);
  }

  log(`IDENTIFIED: [${task.category}] ${task.description}`);
  log(`  Files: ${task.files.join(", ")}`);

  // Output task for the executing agent
  console.log(
    JSON.stringify(
      {
        cycle: state.cycle + 1,
        task,
        auditResult: {
          testCount: auditResult.testCount,
          weakPoints: auditResult.weakPoints.slice(0, 5),
        },
        previousImprovements: state.improvements.slice(-5),
      },
      null,
      2,
    ),
  );

  // Update state
  state.cycle++;
  state.lastTestCount = auditResult.testCount;
  state.lastRunAt = new Date().toISOString();
  saveState(state);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
