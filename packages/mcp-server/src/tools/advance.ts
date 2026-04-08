import * as fs from "node:fs";
import * as path from "node:path";
import { loadBlueprint } from "../state.js";
import type { SubGoalSpec } from "@swm/compiler";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleEntry {
  readonly subGoalName: string;
  readonly agentId: string;
  readonly assignedAt: number;
}

interface Schedule {
  readonly runId: string;
  readonly entries: readonly ScheduleEntry[];
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

function runsDir(projectDir: string): string {
  return path.join(projectDir, ".ada", "runs");
}

function latestRunId(projectDir: string): string | null {
  try {
    const dir = runsDir(projectDir);
    const entries = fs
      .readdirSync(dir)
      .filter((e) => {
        try {
          return fs.statSync(path.join(dir, e)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

function loadSchedule(projectDir: string): Schedule | null {
  const runId = latestRunId(projectDir);
  if (!runId) return null;
  const schedulePath = path.join(runsDir(projectDir), runId, "schedule.json");
  try {
    const raw = fs.readFileSync(schedulePath, "utf8");
    return JSON.parse(raw) as Schedule;
  } catch {
    return null;
  }
}

function executionStatePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "execution-state.json");
}

interface TaskRecord {
  readonly status: "in_progress" | "complete" | "blocked";
  readonly completedAt?: number;
  readonly evidence: readonly string[];
}

interface ExecutionState {
  readonly tasks: Record<string, TaskRecord>;
}

function loadExecutionState(projectDir: string): ExecutionState {
  try {
    const raw = fs.readFileSync(executionStatePath(projectDir), "utf8");
    return JSON.parse(raw) as ExecutionState;
  } catch {
    return { tasks: {} };
  }
}

// ─── SubGoal selection ────────────────────────────────────────────────────────

/**
 * Finds the subGoal to assign to this agentId:
 * 1. If schedule.json exists and assigns this agentId, use that subGoal.
 * 2. Otherwise pick the first subGoal that is not yet complete and whose
 *    dependsOn entries are all complete.
 */
function selectSubGoal(
  agentId: string,
  subGoals: readonly SubGoalSpec[],
  schedule: Schedule | null,
  execState: ExecutionState,
): SubGoalSpec | null {
  // Scheduled assignment takes priority
  if (schedule) {
    const entry = schedule.entries.find((e) => e.agentId === agentId);
    if (entry) {
      const assigned = subGoals.find((g) => g.name === entry.subGoalName);
      if (assigned) return assigned;
    }
  }

  // Find first incomplete subGoal with satisfied dependencies
  for (const goal of subGoals) {
    const taskRecord = execState.tasks[goal.name];
    if (taskRecord?.status === "complete") continue;

    const depsComplete = goal.dependsOn.every((dep) => {
      const depRecord = execState.tasks[dep];
      return depRecord?.status === "complete";
    });

    if (depsComplete) return goal;
  }

  return null;
}

// ─── Dependency resolution ────────────────────────────────────────────────────

function buildDependencyContext(
  subGoal: SubGoalSpec,
  allSubGoals: readonly SubGoalSpec[],
  execState: ExecutionState,
): string {
  if (subGoal.dependsOn.length === 0) {
    return "None — this is a root context.";
  }

  const lines: string[] = [];
  for (const depName of subGoal.dependsOn) {
    const dep = allSubGoals.find((g) => g.name === depName);
    const record = execState.tasks[depName];
    const statusNote =
      record?.status === "complete" ? "(complete)" : "(pending)";
    if (dep) {
      lines.push(`- ${dep.name} ${statusNote}: ${dep.derivedIntent}`);
    } else {
      lines.push(`- ${depName} ${statusNote}`);
    }
  }
  return lines.join("\n");
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

/**
 * Returns a structured task brief for the given agentId based on the
 * blueprint's subGoals array and any existing execution schedule.
 *
 * Falls back gracefully when:
 * - No blueprint exists
 * - Blueprint has no subGoals
 * - State file is missing or malformed
 */
export function advanceExecution(
  agentId: string,
  projectDir?: string,
): { content: string; isError: boolean } {
  const dir = getProjectDir(projectDir);

  try {
    const blueprint = loadBlueprint();

    if (!blueprint) {
      return {
        content:
          "No compiled blueprint found. Run 'ada compile <intent>' first to produce a blueprint, then call ada.advance_execution again.",
        isError: true,
      };
    }

    const subGoals = blueprint.subGoals;
    if (!subGoals || subGoals.length === 0) {
      // Blueprint exists but has no subGoals — fall back to macro plan guidance
      return {
        content: [
          "TASK BRIEF — Ada Execution Protocol",
          "=====================================",
          `You are agent: ${agentId}`,
          "",
          "This blueprint has no subGoals defined (single bounded context).",
          "Call ada.get_macro_plan() to get the ordered component list.",
          "Call ada.get_contract('<boundedContext>') for delegation constraints.",
          "",
          "GOVERNANCE:",
          "- Call ada.check_drift() before any major architectural decision",
          "- Call ada.verify() when you believe implementation is complete",
        ].join("\n"),
        isError: false,
      };
    }

    const schedule = loadSchedule(dir);
    const execState = loadExecutionState(dir);

    const subGoal = selectSubGoal(agentId, subGoals, schedule, execState);

    if (!subGoal) {
      // Check if everything is done
      const allComplete = subGoals.every(
        (g) => execState.tasks[g.name]?.status === "complete",
      );

      if (allComplete) {
        return {
          content: [
            "TASK BRIEF — Ada Execution Protocol",
            "=====================================",
            `You are agent: ${agentId}`,
            "",
            `All ${subGoals.length} subGoals are complete. Blueprint execution finished.`,
            "",
            "Call ada.verify() to run the final verification stack.",
          ].join("\n"),
          isError: false,
        };
      }

      return {
        content: [
          "TASK BRIEF — Ada Execution Protocol",
          "=====================================",
          `You are agent: ${agentId}`,
          "",
          "No unblocked subGoal available. Dependencies are not yet satisfied.",
          "Call ada.get_macro_plan() to see the current execution state.",
          "",
          "Remaining subGoals:",
          ...subGoals
            .filter((g) => execState.tasks[g.name]?.status !== "complete")
            .map(
              (g) =>
                `  - ${g.name} (depends on: ${g.dependsOn.join(", ") || "nothing"})`,
            ),
        ].join("\n"),
        isError: false,
      };
    }

    const entitiesSection =
      subGoal.entities.length > 0
        ? subGoal.entities.join("\n")
        : "None specified.";

    const workflowsSection =
      subGoal.workflows.length > 0
        ? subGoal.workflows.join("\n")
        : "None specified.";

    const invariantsSection =
      subGoal.invariants.length > 0
        ? subGoal.invariants.join("\n")
        : "None specified.";

    const dependencyContext = buildDependencyContext(
      subGoal,
      subGoals,
      execState,
    );

    const brief = [
      "TASK BRIEF — Ada Execution Protocol",
      "=====================================",
      `You are agent: ${agentId}`,
      `Bounded context: ${subGoal.name}`,
      "",
      "YOUR MISSION:",
      subGoal.derivedIntent,
      "",
      "ENTITIES YOU OWN:",
      entitiesSection,
      "",
      "WORKFLOWS YOU OWN:",
      workflowsSection,
      "",
      "INVARIANTS YOU MUST PRESERVE:",
      invariantsSection,
      "",
      "DEPENDENCIES ALREADY COMPLETE:",
      dependencyContext,
      "",
      "COMPLETION SIGNAL:",
      `When your bounded context is complete, call ada.set_task_status("${subGoal.name}", "complete")`,
      "with evidence of what you built.",
      "",
      "GOVERNANCE:",
      "- Call ada.check_drift() before any major architectural decision",
      `- Call ada.get_contract("${subGoal.name}") for your full delegation contract`,
      "- Call ada.verify() when you believe your context is complete",
    ].join("\n");

    return { content: brief, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `advance_execution error: ${message}`,
      isError: true,
    };
  }
}
