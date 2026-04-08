import * as fs from "node:fs";
import * as path from "node:path";
import { loadBlueprint } from "../state.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskRecord {
  readonly status: "in_progress" | "complete" | "blocked";
  readonly completedAt?: number;
  readonly evidence: readonly string[];
}

interface ExecutionState {
  readonly tasks: Record<string, TaskRecord>;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getProjectDir(projectDir?: string): string {
  if (projectDir) return projectDir;
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"]!)
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

function executionStatePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "execution-state.json");
}

function loadExecutionState(projectDir: string): ExecutionState {
  try {
    const raw = fs.readFileSync(executionStatePath(projectDir), "utf8");
    return JSON.parse(raw) as ExecutionState;
  } catch {
    return { tasks: {} };
  }
}

function saveExecutionState(projectDir: string, state: ExecutionState): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    executionStatePath(projectDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

// ─── Unblocked dependency resolution ─────────────────────────────────────────

/**
 * After marking `component` as complete, finds which subGoals are now
 * unblocked (all their dependsOn entries are complete).
 */
function findUnblockedSubGoals(
  completedComponent: string,
  updatedState: ExecutionState,
  projectDir: string,
): string[] {
  const blueprint = loadBlueprint();
  if (!blueprint?.subGoals) return [];

  const unblocked: string[] = [];

  for (const goal of blueprint.subGoals) {
    // Skip if already complete or if this isn't a downstream dependent
    if (updatedState.tasks[goal.name]?.status === "complete") continue;
    if (!goal.dependsOn.includes(completedComponent)) continue;

    // Check if all its dependencies are now complete
    const allDepsComplete = goal.dependsOn.every(
      (dep) => updatedState.tasks[dep]?.status === "complete",
    );

    if (allDepsComplete) {
      unblocked.push(goal.name);
    }
  }

  return unblocked;
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

/**
 * Writes task status to .ada/execution-state.json.
 * When status is "complete", also reports which dependent subGoals are
 * now unblocked.
 */
export function setTaskStatus(
  component: string,
  status: "in_progress" | "complete" | "blocked",
  evidence: string[],
  projectDir?: string,
): { content: string; isError: boolean } {
  const dir = getProjectDir(projectDir);

  try {
    const state = loadExecutionState(dir);

    const record: TaskRecord = {
      status,
      ...(status === "complete" && { completedAt: Date.now() }),
      evidence,
    };

    const updated: ExecutionState = {
      tasks: {
        ...state.tasks,
        [component]: record,
      },
    };

    saveExecutionState(dir, updated);

    const evidenceNote =
      evidence.length > 0 ? `\nEvidence: ${evidence.join(", ")}` : "";

    const lines: string[] = [
      `Task status updated: ${component} → ${status}${evidenceNote}`,
    ];

    if (status === "complete") {
      const unblocked = findUnblockedSubGoals(component, updated, dir);
      if (unblocked.length > 0) {
        lines.push("");
        lines.push("SubGoals now unblocked:");
        for (const name of unblocked) {
          lines.push(`  - ${name}`);
        }
        lines.push("");
        lines.push(
          "Call ada.advance_execution(<agentId>) to receive the next task brief.",
        );
      } else {
        lines.push(
          "Call ada.advance_execution(<agentId>) to check for the next task.",
        );
      }
    }

    return { content: lines.join("\n"), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to set task status: ${message}`,
      isError: true,
    };
  }
}
