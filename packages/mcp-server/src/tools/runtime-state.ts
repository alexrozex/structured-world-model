import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { loadBlueprint, loadManifest } from "../state.js";
import type { DelegationFrame } from "@swm/compiler";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvironmentFact {
  readonly id: string;
  readonly fact: string;
  readonly source: "tool_output" | "inferred";
  readonly confidence: number; // 0–1
  readonly observedAt: number;
  readonly evidencePath?: string;
}

export interface ComponentExecutionStatus {
  readonly name: string;
  readonly boundedContext: string;
  readonly status: "pending" | "in_progress" | "complete" | "inferred_complete";
  readonly evidence: readonly string[];
}

export interface RuntimeCheckpoint {
  readonly id: string;
  readonly createdAt: number;
  readonly description: string;
  readonly gitRef: string | null;
  readonly worldStateVersion: number;
}

export interface WorldState {
  readonly version: number;
  readonly runId: string | null;
  readonly capturedAt: number;
  readonly uncertaintyScore: number; // 0–1, higher = less certain
  readonly environmentFacts: readonly EnvironmentFact[];
  readonly components: readonly ComponentExecutionStatus[];
  readonly checkpoints: readonly RuntimeCheckpoint[];
  readonly sessionCount: number;
  readonly totalToolCalls: number;
  readonly recentPaths: readonly string[];
  readonly delegationDepth: number;
  readonly activeDelegations: readonly DelegationFrame[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function getProjectDir(): string {
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"]!)
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

function runtimeStatePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "runtime-state.json");
}

function sessionLogPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "session-log.jsonl");
}

// ─── Session log parsing ─────────────────────────────────────────────────────

interface SessionLogEntry {
  ts: number;
  session: string;
  tool: string;
  path: string;
}

function readSessionLog(logPath: string): SessionLogEntry[] {
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as SessionLogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is SessionLogEntry => e !== null);
  } catch {
    return [];
  }
}

// ─── WorldState builder ───────────────────────────────────────────────────────

/**
 * Builds a WorldState snapshot by combining:
 * - Session log (what tool calls have been made, which files touched)
 * - Compiled blueprint (what components were planned)
 * - Filesystem (which planned files actually exist)
 * - Persisted checkpoints (rollback points)
 */
export function buildWorldState(): WorldState {
  const projectDir = getProjectDir();
  const entries = readSessionLog(sessionLogPath(projectDir));
  const blueprint = loadBlueprint();
  const manifest = loadManifest();
  const explicitStatuses = loadTaskStatuses(projectDir);
  const explicitFacts = loadFacts(projectDir);

  // ── Session metrics ──────────────────────────────────────────────────────
  const sessionIds = new Set(entries.map((e) => e.session).filter(Boolean));
  const totalToolCalls = entries.length;

  // ── Files touched ────────────────────────────────────────────────────────
  const writePaths = entries
    .filter((e) => ["Write", "Edit", "MultiEdit"].includes(e.tool) && e.path)
    .map((e) => e.path);
  const uniqueWritePaths = [...new Set(writePaths)];
  const recentPaths = uniqueWritePaths.slice(-20);

  // ── Environment facts from filesystem ───────────────────────────────────
  const environmentFacts: EnvironmentFact[] = [];

  // Inferred facts from session log (file writes)
  for (const p of uniqueWritePaths.slice(-50)) {
    const absPath = path.isAbsolute(p) ? p : path.join(projectDir, p);
    const exists = fs.existsSync(absPath);
    environmentFacts.push({
      id: `file:${p}`,
      fact: exists
        ? `File exists: ${p}`
        : `File written but no longer found: ${p}`,
      source: "tool_output",
      confidence: exists ? 0.95 : 0.4,
      observedAt: Date.now(),
      evidencePath: p,
    });
  }

  // Explicit facts recorded by agents (higher authority than inferred)
  for (const ef of explicitFacts) {
    environmentFacts.push({
      id: ef.id,
      fact: ef.fact,
      source: ef.source,
      confidence: ef.confidence,
      observedAt: ef.recordedAt,
      ...(ef.evidencePath !== undefined && { evidencePath: ef.evidencePath }),
    });
  }

  // ── Component execution status ───────────────────────────────────────────
  const components: ComponentExecutionStatus[] = [];
  if (blueprint?.architecture?.components) {
    for (const comp of blueprint.architecture.components) {
      // Infer status: if any written path mentions the component name or bounded context
      const nameLower = comp.name.toLowerCase().replace(/\s+/g, "");
      const contextLower = comp.boundedContext
        .toLowerCase()
        .replace(/\s+/g, "");
      const matchingPaths = uniqueWritePaths.filter((p) => {
        const pl = p.toLowerCase();
        return pl.includes(nameLower) || pl.includes(contextLower);
      });

      // Explicit status takes precedence over inferred
      const explicit = explicitStatuses.find(
        (s) => s.componentName.toLowerCase() === comp.name.toLowerCase(),
      );

      let status: ComponentExecutionStatus["status"];
      let evidence: string[];

      if (explicit?.status === "complete") {
        status = "inferred_complete"; // "complete" maps to inferred_complete for display
        evidence = [...explicit.evidence, ...matchingPaths].slice(0, 5);
      } else if (explicit?.status === "in_progress") {
        status = "in_progress";
        evidence = [...explicit.evidence, ...matchingPaths].slice(0, 5);
      } else if (matchingPaths.length > 0) {
        status = "inferred_complete";
        evidence = matchingPaths.slice(0, 5);
      } else {
        status = "pending";
        evidence = [];
      }

      components.push({
        name: comp.name,
        boundedContext: comp.boundedContext,
        status,
        evidence,
      });
    }
  }

  // ── Uncertainty score ────────────────────────────────────────────────────
  // Computed from per-fact confidence when explicit facts exist;
  // falls back to heuristic when no facts recorded.
  let uncertaintyScore: number;

  if (explicitFacts.length > 0) {
    // Average uncertainty across all recorded facts (1 - confidence)
    const avgUncertainty =
      explicitFacts.reduce((sum, f) => sum + (1 - f.confidence), 0) /
      explicitFacts.length;
    // Blend with baseline heuristic (weight explicit facts more heavily)
    const hasLog = entries.length > 0;
    const baseline = !hasLog ? 0.9 : !blueprint ? 0.8 : 0.5;
    uncertaintyScore = avgUncertainty * 0.7 + baseline * 0.3;
  } else {
    const hasLog = entries.length > 0;
    const hasBlueprintMatch =
      components.length > 0 &&
      components.some((c) => c.status === "inferred_complete");
    if (!hasLog) uncertaintyScore = 0.9;
    else if (!blueprint) uncertaintyScore = 0.8;
    else if (hasBlueprintMatch) uncertaintyScore = 0.3;
    else uncertaintyScore = 0.6;
  }

  // ── Load persisted checkpoints ───────────────────────────────────────────
  const checkpoints = loadCheckpoints(projectDir);

  // ── Delegation stack ─────────────────────────────────────────────────────
  let activeDelegations: DelegationFrame[] = [];
  try {
    const stackRaw = fs.readFileSync(
      path.join(projectDir, ".ada", "delegation-stack.json"),
      "utf8",
    );
    activeDelegations = JSON.parse(stackRaw) as DelegationFrame[];
  } catch {
    // no stack file yet
  }

  return {
    version: entries.length,
    runId: manifest?.runId ?? null,
    capturedAt: Date.now(),
    uncertaintyScore,
    environmentFacts,
    components,
    checkpoints,
    sessionCount: sessionIds.size,
    totalToolCalls,
    recentPaths,
    delegationDepth: activeDelegations.length,
    activeDelegations,
  };
}

// ─── Explicit fact recording (uncertainty tracking) ──────────────────────────

interface ExplicitFact {
  readonly id: string;
  readonly fact: string;
  readonly source: "tool_output" | "inferred";
  readonly confidence: number;
  readonly evidencePath?: string;
  readonly recordedAt: number;
}

function factsPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "facts.json");
}

function loadFacts(projectDir: string): ExplicitFact[] {
  try {
    const raw = fs.readFileSync(factsPath(projectDir), "utf8");
    return JSON.parse(raw) as ExplicitFact[];
  } catch {
    return [];
  }
}

function saveFacts(projectDir: string, facts: ExplicitFact[]): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    factsPath(projectDir),
    JSON.stringify(facts, null, 2),
    "utf8",
  );
}

export function recordFact(
  fact: string,
  confidence: number,
  source: "tool_output" | "inferred",
  evidencePath?: string,
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();

  try {
    const facts = loadFacts(projectDir);
    const clampedConfidence = Math.max(0, Math.min(1, confidence));
    const id = `fact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const record: ExplicitFact = {
      id,
      fact,
      source,
      confidence: clampedConfidence,
      ...(evidencePath !== undefined && { evidencePath }),
      recordedAt: Date.now(),
    };

    saveFacts(projectDir, [...facts, record]);

    const confidencePct = Math.round(clampedConfidence * 100);
    return {
      content: `Fact recorded [${id}] — confidence ${confidencePct}% (${source}):\n${fact}`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to record fact: ${message}`, isError: true };
  }
}

// ─── Explicit task status ─────────────────────────────────────────────────────

interface ExplicitTaskStatus {
  readonly componentName: string;
  readonly status: "in_progress" | "complete";
  readonly evidence: readonly string[];
  readonly updatedAt: number;
}

function taskStatusPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "task-status.json");
}

function loadTaskStatuses(projectDir: string): ExplicitTaskStatus[] {
  try {
    const raw = fs.readFileSync(taskStatusPath(projectDir), "utf8");
    return JSON.parse(raw) as ExplicitTaskStatus[];
  } catch {
    return [];
  }
}

function saveTaskStatuses(
  projectDir: string,
  statuses: ExplicitTaskStatus[],
): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    taskStatusPath(projectDir),
    JSON.stringify(statuses, null, 2),
    "utf8",
  );
}

export function setTaskStatus(
  componentName: string,
  status: "in_progress" | "complete",
  evidence: string[],
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();

  try {
    const statuses = loadTaskStatuses(projectDir);
    const record: ExplicitTaskStatus = {
      componentName,
      status,
      evidence,
      updatedAt: Date.now(),
    };

    // Replace existing record for this component or append
    const idx = statuses.findIndex((s) => s.componentName === componentName);
    const updated =
      idx >= 0
        ? statuses.map((s, i) => (i === idx ? record : s))
        : [...statuses, record];

    saveTaskStatuses(projectDir, updated);

    const evidenceNote =
      evidence.length > 0 ? `\nEvidence: ${evidence.join(", ")}` : "";

    return {
      content: `Task status updated: ${componentName} → ${status}${evidenceNote}\nCall ada.get_macro_plan to see updated execution plan.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to set task status: ${message}`, isError: true };
  }
}

// ─── Checkpoint management ────────────────────────────────────────────────────

function checkpointsPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "checkpoints.json");
}

function loadCheckpoints(projectDir: string): RuntimeCheckpoint[] {
  try {
    const raw = fs.readFileSync(checkpointsPath(projectDir), "utf8");
    return JSON.parse(raw) as RuntimeCheckpoint[];
  } catch {
    return [];
  }
}

function saveCheckpoints(
  projectDir: string,
  checkpoints: RuntimeCheckpoint[],
): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    checkpointsPath(projectDir),
    JSON.stringify(checkpoints, null, 2),
    "utf8",
  );
}

function gitStash(projectDir: string, message: string): string | null {
  const r = spawnSync(
    "git",
    ["stash", "push", "--include-untracked", "-m", message],
    { cwd: projectDir, encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  // Get the stash ref (stash@{0})
  const listR = spawnSync("git", ["stash", "list", "--max-count=1"], {
    cwd: projectDir,
    encoding: "utf8",
  });
  const firstLine = listR.stdout.split("\n")[0] ?? "";
  const match = firstLine.match(/^(stash@\{\d+\})/);
  return match?.[1] ?? null;
}

// ─── MCP tool handlers ────────────────────────────────────────────────────────

export function getRuntimeState(): { content: string; isError: boolean } {
  try {
    const state = buildWorldState();

    const summary = [
      `Runtime state (v${state.version})`,
      `Run: ${state.runId ?? "none"}`,
      `Captured: ${new Date(state.capturedAt).toISOString()}`,
      `Uncertainty: ${(state.uncertaintyScore * 100).toFixed(0)}%`,
      `Sessions: ${state.sessionCount}  Tool calls: ${state.totalToolCalls}  Delegation depth: ${state.delegationDepth}`,
      "",
    ];

    if (state.components.length > 0) {
      summary.push("Components:");
      for (const c of state.components) {
        const icon =
          c.status === "inferred_complete"
            ? "✓"
            : c.status === "pending"
              ? "○"
              : "~";
        summary.push(`  ${icon} ${c.name} [${c.boundedContext}] — ${c.status}`);
        if (c.evidence.length > 0) {
          summary.push(`    evidence: ${c.evidence.join(", ")}`);
        }
      }
      summary.push("");
    }

    if (state.recentPaths.length > 0) {
      summary.push("Recently modified:");
      for (const p of state.recentPaths.slice(-10)) {
        summary.push(`  ${p}`);
      }
      summary.push("");
    }

    if (state.checkpoints.length > 0) {
      summary.push("Checkpoints:");
      for (const cp of state.checkpoints) {
        summary.push(
          `  [${cp.id}] ${cp.description} — ${new Date(cp.createdAt).toISOString()}`,
        );
      }
    }

    summary.push("", JSON.stringify(state, null, 2));

    return { content: summary.join("\n"), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to build runtime state: ${message}`,
      isError: true,
    };
  }
}

export function createCheckpoint(description: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();

  try {
    const checkpoints = loadCheckpoints(projectDir);
    const state = buildWorldState();

    // Attempt git stash for hard rollback capability
    const gitRef = gitStash(projectDir, `ada-checkpoint: ${description}`);

    const checkpoint: RuntimeCheckpoint = {
      id: `cp-${Date.now()}`,
      createdAt: Date.now(),
      description,
      gitRef,
      worldStateVersion: state.version,
    };

    checkpoints.push(checkpoint);
    saveCheckpoints(projectDir, checkpoints);

    return {
      content: gitRef
        ? `Checkpoint created: ${checkpoint.id}\nDescription: ${description}\nGit ref: ${gitRef}\nRollback: ada.rollback_to("${checkpoint.id}")`
        : `Checkpoint created: ${checkpoint.id}\nDescription: ${description}\nNote: git stash unavailable — checkpoint is metadata only.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to create checkpoint: ${message}`,
      isError: true,
    };
  }
}

export function rollbackTo(checkpointId: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();

  try {
    const checkpoints = loadCheckpoints(projectDir);
    const target = checkpoints.find((cp) => cp.id === checkpointId);

    if (!target) {
      const ids = checkpoints.map((cp) => cp.id).join(", ");
      return {
        content: `Checkpoint not found: ${checkpointId}\nAvailable: ${ids || "none"}`,
        isError: true,
      };
    }

    if (!target.gitRef) {
      return {
        content: `Checkpoint ${checkpointId} has no git ref — was created without git stash. Cannot roll back filesystem state.\nCheckpoint metadata: ${JSON.stringify(target, null, 2)}`,
        isError: true,
      };
    }

    // Pop the stash to restore the filesystem state
    const r = spawnSync("git", ["stash", "pop", target.gitRef], {
      cwd: projectDir,
      encoding: "utf8",
    });

    if (r.status !== 0) {
      return {
        content: `Git stash pop failed for ${target.gitRef}:\n${r.stderr}`,
        isError: true,
      };
    }

    // Remove this and all later checkpoints from the list
    const idx = checkpoints.indexOf(target);
    const remaining = checkpoints.slice(0, idx);
    saveCheckpoints(projectDir, remaining);

    return {
      content: `Rolled back to checkpoint: ${checkpointId}\nDescription: ${target.description}\nCreated: ${new Date(target.createdAt).toISOString()}\nFilesystem restored via git stash pop ${target.gitRef}.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Rollback failed: ${message}`, isError: true };
  }
}
