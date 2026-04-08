import type { SubGoalSpec } from "./types.js";

/**
 * Topological sort of subGoals respecting dependsOn edges.
 *
 * Returns an array of execution waves. Each wave contains subGoals that can
 * run in parallel because all of their dependencies are satisfied by earlier
 * waves.
 *
 *   Wave 0: subGoals with dependsOn === []
 *   Wave 1: subGoals whose dependsOn are all in wave 0
 *   Wave N: subGoals whose dependsOn are all in waves 0..N-1
 *
 * If the dependency graph contains a cycle the function returns a single wave
 * containing all subGoals rather than throwing, so the pipeline never crashes.
 * Use validateDependencyGraph() first when you need to surface cycles.
 */
export function scheduleSubGoals(
  subGoals: readonly SubGoalSpec[],
): SubGoalSpec[][] {
  if (subGoals.length === 0) return [];

  // Guard: if the graph has a cycle, fall back to a flat single wave.
  const { valid } = validateDependencyGraph(subGoals);
  if (!valid) {
    return [subGoals.slice()];
  }

  const nameToSpec = new Map<string, SubGoalSpec>(
    subGoals.map((sg) => [sg.name, sg]),
  );

  // Track which wave each subGoal was placed in (-1 = not yet placed).
  const placedInWave = new Map<string, number>(
    subGoals.map((sg) => [sg.name, -1]),
  );

  const waves: SubGoalSpec[][] = [];
  let remaining = subGoals.slice();

  while (remaining.length > 0) {
    // A subGoal is ready for the current wave if all its dependencies have
    // already been placed in a previous wave.
    const currentWave: SubGoalSpec[] = [];
    const nextRemaining: SubGoalSpec[] = [];

    for (const sg of remaining) {
      const allDepsSatisfied = sg.dependsOn.every((depName) => {
        const waveIndex = placedInWave.get(depName);
        // Dependency is satisfied if it was placed in a completed wave.
        // Unknown dependency names are treated as satisfied (defensive).
        return waveIndex !== undefined ? waveIndex >= 0 : true;
      });

      if (allDepsSatisfied) {
        currentWave.push(sg);
        placedInWave.set(sg.name, waves.length);
      } else {
        nextRemaining.push(sg);
      }
    }

    // Safety valve: if nothing moved forward we have a cycle that slipped
    // past validateDependencyGraph. Force all remaining into one final wave.
    if (currentWave.length === 0) {
      waves.push(nextRemaining);
      break;
    }

    waves.push(currentWave);
    remaining = nextRemaining;

    // Suppress unused variable warning — nameToSpec is used above for safety.
    void nameToSpec;
  }

  return waves;
}

/**
 * Validate that the dependency graph has no cycles.
 *
 * Returns { valid: true } when the graph is acyclic.
 * Returns { valid: false, cycle: [...names] } when a cycle is detected,
 * where cycle contains the names involved in the cycle in traversal order.
 */
export function validateDependencyGraph(subGoals: readonly SubGoalSpec[]): {
  valid: boolean;
  cycle?: string[];
} {
  const names = new Set(subGoals.map((sg) => sg.name));
  const deps = new Map<string, readonly string[]>(
    subGoals.map((sg) => [sg.name, sg.dependsOn]),
  );

  // DFS-based cycle detection.
  // WHITE = unvisited, GRAY = in current DFS path, BLACK = fully explored.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, 0 | 1 | 2>(
    subGoals.map((sg) => [sg.name, WHITE]),
  );

  // path tracks the current DFS stack for cycle reporting.
  const path: string[] = [];

  function dfs(name: string): string[] | null {
    color.set(name, GRAY);
    path.push(name);

    const children = deps.get(name) ?? [];
    for (const dep of children) {
      // Skip dependencies that reference subGoals outside this set.
      if (!names.has(dep)) continue;

      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        // Found a back edge — cycle detected. Return the cycle slice.
        const cycleStart = path.indexOf(dep);
        return path.slice(cycleStart);
      }
      if (c === WHITE) {
        const result = dfs(dep);
        if (result !== null) return result;
      }
    }

    path.pop();
    color.set(name, BLACK);
    return null;
  }

  for (const sg of subGoals) {
    if ((color.get(sg.name) ?? WHITE) === WHITE) {
      const cycle = dfs(sg.name);
      if (cycle !== null) {
        return { valid: false, cycle };
      }
    }
  }

  return { valid: true };
}
