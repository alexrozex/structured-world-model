import * as fs from "node:fs";
import * as path from "node:path";
import { loadBlueprint } from "../state.js";
import { getMacroPlan } from "./macro-plan.js";
import { enterDelegation } from "./get-contract.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrchestrationStatus =
  | "task_assigned" // Next task identified, delegation entered
  | "all_complete" // All tasks in the macro plan are done
  | "blocked" // Next task is blocked by incomplete dependencies
  | "no_blueprint"; // No compiled blueprint to orchestrate against

export interface OrchestrationResult {
  readonly status: OrchestrationStatus;
  readonly componentName: string | null;
  readonly boundedContext: string | null;
  readonly agentFile: string | null;
  readonly responsibility: string | null;
  readonly interfaces: readonly string[];
  readonly delegationDepth: number;
  readonly repairBudget: number; // default max retries for this task
  readonly instructions: string; // human-readable execution instructions
}

// ─── SubGoal state ────────────────────────────────────────────────────────────

interface SubGoalEntry {
  name: string;
  status: string;
  completedAt?: number;
  evidence?: string[];
}

interface SubGoalState {
  subGoals: SubGoalEntry[];
}

function subGoalStatePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "subgoal-state.json");
}

export function completeSubGoal(
  subGoalName: string,
  evidence: string[],
): { content: string; isError: boolean } {
  const projectDir = process.env["ADA_PROJECT_DIR"] ?? process.cwd();
  const statePath = subGoalStatePath(projectDir);

  try {
    let state: SubGoalState = { subGoals: [] };

    try {
      const raw = fs.readFileSync(statePath, "utf8");
      state = JSON.parse(raw) as SubGoalState;
    } catch {
      // File doesn't exist or is unparseable — start fresh
    }

    const existing = state.subGoals.find((sg) => sg.name === subGoalName);
    if (existing) {
      existing.status = "complete";
      existing.completedAt = Date.now();
      existing.evidence = evidence;
    } else {
      state.subGoals.push({
        name: subGoalName,
        status: "complete",
        completedAt: Date.now(),
        evidence,
      });
    }

    fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

    const content = [
      `✓ SubGoal "${subGoalName}" marked complete.`,
      `Evidence recorded: ${evidence.length} items`,
      ``,
      `The Ada orchestrator will now unlock dependent subGoals.`,
      `Your session is complete — you may exit.`,
    ].join("\n");

    return { content, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to record subGoal completion: ${message}`,
      isError: true,
    };
  }
}

// ─── Path helper ──────────────────────────────────────────────────────────────

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

function orchestratorStatePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "orchestrator-state.json");
}

interface OrchestratorState {
  readonly currentComponentName: string | null;
  readonly cycleCount: number;
  readonly startedAt: number;
  readonly lastAdvancedAt: number;
}

function loadOrchestratorState(projectDir: string): OrchestratorState {
  try {
    const raw = fs.readFileSync(orchestratorStatePath(projectDir), "utf8");
    return JSON.parse(raw) as OrchestratorState;
  } catch {
    return {
      currentComponentName: null,
      cycleCount: 0,
      startedAt: Date.now(),
      lastAdvancedAt: Date.now(),
    };
  }
}

function saveOrchestratorState(
  projectDir: string,
  state: OrchestratorState,
): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    orchestratorStatePath(projectDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

/**
 * Advances the execution cycle:
 * 1. Reads the macro plan to find the next unblocked pending task
 * 2. Enters delegation for that task's bounded context
 * 3. Returns detailed execution instructions
 *
 * The caller (executor agent) is expected to:
 * - Implement the task within the contract scope
 * - Call ada.set_task_status(componentName, "complete", evidence)
 * - Call ada.exit_delegation(agentId) when done
 * - Call ada.advance_execution again for the next task
 */
export function advanceExecution(agentId: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();

  try {
    const blueprint = loadBlueprint();
    if (!blueprint) {
      const result: OrchestrationResult = {
        status: "no_blueprint",
        componentName: null,
        boundedContext: null,
        agentFile: null,
        responsibility: null,
        interfaces: [],
        delegationDepth: 0,
        repairBudget: 3,
        instructions:
          "No compiled blueprint found. Run 'ada compile' first to produce a blueprint.",
      };
      return { content: JSON.stringify(result, null, 2), isError: true };
    }

    // Get the current macro plan
    const planResult = getMacroPlan();
    if (planResult.isError) {
      return { content: planResult.content, isError: true };
    }

    // Parse the JSON embedded at the end of the plan output
    const jsonMatch = planResult.content.match(/\{[\s\S]*\}$/);
    if (!jsonMatch) {
      return {
        content: "Failed to parse macro plan output",
        isError: true,
      };
    }

    const plan = JSON.parse(jsonMatch[0]) as {
      tasks: Array<{
        componentName: string;
        boundedContext: string;
        agentFile: string;
        responsibility: string;
        interfaces: string[];
        status: string;
        blockedBy: string[];
      }>;
      completedTasks: number;
      totalTasks: number;
    };

    // Find next unblocked pending task
    const nextTask = plan.tasks.find(
      (t) => t.status === "pending" && t.blockedBy.length === 0,
    );

    if (!nextTask) {
      const allDone = plan.completedTasks === plan.totalTasks;
      const result: OrchestrationResult = {
        status: allDone ? "all_complete" : "blocked",
        componentName: null,
        boundedContext: null,
        agentFile: null,
        responsibility: null,
        interfaces: [],
        delegationDepth: 0,
        repairBudget: 3,
        instructions: allDone
          ? `All ${plan.totalTasks} tasks complete. Blueprint execution finished.`
          : `Next tasks are blocked by incomplete dependencies. Check ada.get_macro_plan for details.`,
      };
      return { content: JSON.stringify(result, null, 2), isError: false };
    }

    // Enter delegation for this task's bounded context
    const delegationResult = enterDelegation(nextTask.boundedContext, agentId);

    // Save orchestrator state
    const orchState = loadOrchestratorState(projectDir);
    saveOrchestratorState(projectDir, {
      ...orchState,
      currentComponentName: nextTask.componentName,
      cycleCount: orchState.cycleCount + 1,
      lastAdvancedAt: Date.now(),
    });

    const delegationInfo = delegationResult.isError
      ? `\nNote: Delegation warning — ${delegationResult.content}`
      : "";

    const instructions = [
      `## Execution Brief: ${nextTask.componentName}`,
      ``,
      `**Bounded Context:** ${nextTask.boundedContext}`,
      `**Agent file:** ${nextTask.agentFile}`,
      ``,
      `**Responsibility:**`,
      nextTask.responsibility,
      ``,
      `**Interfaces to implement:**`,
      ...nextTask.interfaces.map((i) => `  - ${i}`),
      ``,
      `**Execution protocol:**`,
      `  1. Implement ${nextTask.componentName} according to the blueprint`,
      `  2. If a step fails: call ada.report_execution_failure for retry guidance`,
      `  3. When implementation is complete: call ada.set_task_status("${nextTask.componentName}", "complete", [<evidence paths>])`,
      `  4. Call ada.exit_delegation("${agentId}")`,
      `  5. Call ada.advance_execution("${agentId}") to proceed to the next task`,
      delegationInfo,
    ].join("\n");

    const result: OrchestrationResult = {
      status: "task_assigned",
      componentName: nextTask.componentName,
      boundedContext: nextTask.boundedContext,
      agentFile: nextTask.agentFile,
      responsibility: nextTask.responsibility,
      interfaces: nextTask.interfaces,
      delegationDepth: delegationResult.isError ? 0 : 1,
      repairBudget: 3,
      instructions,
    };

    return { content: JSON.stringify(result, null, 2), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Execution orchestrator error: ${message}`,
      isError: true,
    };
  }
}
