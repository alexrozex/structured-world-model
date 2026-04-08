import { loadBlueprint } from "../state.js";
import { buildWorldState } from "./runtime-state.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "inferred_complete"
  | "blocked";

export interface MacroTask {
  readonly ordinal: number;
  readonly componentName: string;
  readonly boundedContext: string;
  readonly agentFile: string;
  readonly responsibility: string;
  readonly interfaces: readonly string[];
  readonly blockedBy: readonly string[]; // component names not yet complete
  readonly status: TaskStatus;
}

export interface MacroPlan {
  readonly runId: string | null;
  readonly summary: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly nextTask: MacroTask | null;
  readonly tasks: readonly MacroTask[];
  readonly capturedAt: number;
}

// ─── Topological sort ─────────────────────────────────────────────────────────

/**
 * Returns component names in dependency order (leaves first).
 * Uses Kahn's algorithm. Cycles are broken by ordinal position.
 */
function topoSort(
  components: ReadonlyArray<{
    name: string;
    dependencies: readonly string[];
  }>,
): string[] {
  const names = new Set(components.map((c) => c.name));
  const inDegree = new Map<string, number>();
  const adjReverse = new Map<string, string[]>(); // name → dependents

  for (const c of components) {
    inDegree.set(c.name, 0);
    adjReverse.set(c.name, []);
  }

  for (const c of components) {
    for (const dep of c.dependencies) {
      if (!names.has(dep)) continue; // external dep, ignore
      inDegree.set(c.name, (inDegree.get(c.name) ?? 0) + 1);
      adjReverse.get(dep)!.push(c.name);
    }
  }

  const queue = components
    .filter((c) => (inDegree.get(c.name) ?? 0) === 0)
    .map((c) => c.name);

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const dependent of adjReverse.get(node) ?? []) {
      const deg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }

  // Append any remaining (cycle members) by original order
  for (const c of components) {
    if (!result.includes(c.name)) result.push(c.name);
  }

  return result;
}

// ─── getMacroPlan ─────────────────────────────────────────────────────────────

export function getMacroPlan(): { content: string; isError: boolean } {
  try {
    const blueprint = loadBlueprint();
    if (!blueprint) {
      return {
        content:
          "No compiled blueprint found. Run `ada compile` first to produce a blueprint.",
        isError: true,
      };
    }

    const worldState = buildWorldState();
    const components = blueprint.architecture.components;

    // Build a set of inferred-complete component names from world-state
    const completeNames = new Set(
      worldState.components
        .filter((c) => c.status === "inferred_complete")
        .map((c) => c.name),
    );

    // Topological order
    const order = topoSort(components);
    const ordinalByName = new Map(order.map((name, i) => [name, i + 1]));

    // Build tasks
    const tasks: MacroTask[] = order.map((name) => {
      const comp = components.find((c) => c.name === name)!;
      const agentFile = `.claude/agents/${comp.boundedContext.toLowerCase().replace(/\s+/g, "-")}-agent.md`;

      // A task is blocked if any of its declared dependencies are not yet complete
      const blockedBy = comp.dependencies.filter(
        (dep) =>
          components.some((c) => c.name === dep) && !completeNames.has(dep),
      );

      let status: TaskStatus;
      if (completeNames.has(name)) {
        status = "inferred_complete";
      } else if (blockedBy.length > 0) {
        status = "blocked";
      } else {
        status = "pending";
      }

      return {
        ordinal: ordinalByName.get(name) ?? 0,
        componentName: name,
        boundedContext: comp.boundedContext,
        agentFile,
        responsibility: comp.responsibility,
        interfaces: comp.interfaces,
        blockedBy,
        status,
      };
    });

    const completedTasks = tasks.filter(
      (t) => t.status === "inferred_complete",
    ).length;

    const nextTask =
      tasks.find((t) => t.status === "pending") ??
      tasks.find((t) => t.status === "in_progress") ??
      null;

    const plan: MacroPlan = {
      runId: worldState.runId,
      summary: blueprint.summary,
      totalTasks: tasks.length,
      completedTasks,
      nextTask,
      tasks,
      capturedAt: Date.now(),
    };

    // ── Format output ────────────────────────────────────────────────────────
    const lines: string[] = [
      `Macro plan — ${completedTasks}/${tasks.length} complete`,
      `Run: ${plan.runId ?? "none"}`,
      `Project: ${blueprint.summary.slice(0, 100)}`,
      "",
    ];

    if (nextTask) {
      lines.push(
        `NEXT: [${nextTask.ordinal}] ${nextTask.componentName} (${nextTask.boundedContext})`,
      );
      lines.push(`  Agent: ${nextTask.agentFile}`);
      lines.push(`  Task: ${nextTask.responsibility.slice(0, 120)}`);
      lines.push("");
    } else if (completedTasks === tasks.length) {
      lines.push("ALL TASKS COMPLETE — blueprint fully executed.");
      lines.push("");
    }

    lines.push("Task list:");
    for (const task of tasks) {
      const icon =
        task.status === "inferred_complete"
          ? "✓"
          : task.status === "blocked"
            ? "✗"
            : task.status === "in_progress"
              ? "~"
              : "○";
      lines.push(
        `  ${icon} [${task.ordinal}] ${task.componentName} [${task.boundedContext}]`,
      );
      if (task.blockedBy.length > 0) {
        lines.push(`      blocked by: ${task.blockedBy.join(", ")}`);
      }
    }

    lines.push("", JSON.stringify(plan, null, 2));

    return { content: lines.join("\n"), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to build macro plan: ${message}`, isError: true };
  }
}
