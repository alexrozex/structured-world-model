export interface SubGoalNode {
  readonly name: string;
  readonly dependsOn: readonly string[];
}

/**
 * Returns execution waves using Kahn's algorithm.
 * Wave 0 = no dependencies. Wave N = depends only on waves 0..N-1.
 * SubGoals in the same wave can run concurrently.
 *
 * Throws if a cycle is detected.
 */
export function topoWaves(nodes: readonly SubGoalNode[]): string[][] {
  const nameSet = new Set(nodes.map((n) => n.name));

  // Build in-degree map and adjacency list (dependsOn -> dependents)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    if (!inDegree.has(node.name)) {
      inDegree.set(node.name, 0);
    }
    if (!dependents.has(node.name)) {
      dependents.set(node.name, []);
    }
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      // Only track edges where the dependency is in the node set
      if (nameSet.has(dep)) {
        inDegree.set(node.name, (inDegree.get(node.name) ?? 0) + 1);
        const list = dependents.get(dep) ?? [];
        list.push(node.name);
        dependents.set(dep, list);
      }
    }
  }

  const waves: string[][] = [];
  let currentWave: string[] = [];

  // Seed: all nodes with in-degree 0
  for (const [name, degree] of inDegree.entries()) {
    if (degree === 0) {
      currentWave.push(name);
    }
  }

  let processed = 0;

  while (currentWave.length > 0) {
    waves.push(currentWave);
    processed += currentWave.length;

    const nextWave: string[] = [];

    for (const name of currentWave) {
      for (const dependent of dependents.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextWave.push(dependent);
        }
      }
    }

    currentWave = nextWave;
  }

  if (processed !== nodes.length) {
    // Cycle detected — identify which nodes are stuck
    const stuck = [...inDegree.entries()]
      .filter(([, d]) => d > 0)
      .map(([name]) => name);
    throw new Error(
      `Cycle detected in subGoal dependency graph. Stuck nodes: ${stuck.join(", ")}`,
    );
  }

  return waves;
}

/**
 * Returns flat execution order. Throws if cycle detected.
 * Nodes within the same wave are returned in stable order (insertion order).
 */
export function topoOrder(nodes: readonly SubGoalNode[]): string[] {
  return topoWaves(nodes).flat();
}
