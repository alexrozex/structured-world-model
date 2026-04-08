import type { WorldModelType } from "../schema/index.js";

type Entity = WorldModelType["entities"][number];
type Relation = WorldModelType["relations"][number];

/**
 * Find all entities that directly depend on or relate to a given entity.
 */
export function findDependents(
  model: WorldModelType,
  entityId: string,
): {
  incoming: Array<{ relation: Relation; entity: Entity }>;
  outgoing: Array<{ relation: Relation; entity: Entity }>;
} {
  const entityMap = new Map(model.entities.map((e) => [e.id, e]));

  const incoming = model.relations
    .filter((r) => r.target === entityId)
    .map((r) => ({ relation: r, entity: entityMap.get(r.source)! }))
    .filter((r) => r.entity);

  const outgoing = model.relations
    .filter((r) => r.source === entityId)
    .map((r) => ({ relation: r, entity: entityMap.get(r.target)! }))
    .filter((r) => r.entity);

  return { incoming, outgoing };
}

/**
 * Find entity by name (case-insensitive partial match).
 */
export function findEntity(
  model: WorldModelType,
  query: string,
): Entity | undefined {
  const q = query.toLowerCase();
  return (
    model.entities.find((e) => e.name.toLowerCase() === q) ??
    model.entities.find((e) => e.name.toLowerCase().includes(q))
  );
}

/**
 * BFS to find shortest path between two entities via relations.
 */
export function pathsBetween(
  model: WorldModelType,
  sourceId: string,
  targetId: string,
  maxDepth = 10,
): Array<{ entity: Entity; relation?: Relation }[]> {
  const entityMap = new Map(model.entities.map((e) => [e.id, e]));

  // Build adjacency list (both directions for traversal)
  const adjacency = new Map<
    string,
    Array<{ neighborId: string; relation: Relation }>
  >();
  for (const ent of model.entities) {
    adjacency.set(ent.id, []);
  }
  for (const rel of model.relations) {
    adjacency.get(rel.source)?.push({ neighborId: rel.target, relation: rel });
    if (rel.bidirectional) {
      adjacency
        .get(rel.target)
        ?.push({ neighborId: rel.source, relation: rel });
    }
  }

  // BFS
  const results: Array<{ entity: Entity; relation?: Relation }>[] = [];
  const queue: Array<{
    path: Array<{ entityId: string; relation?: Relation }>;
  }> = [{ path: [{ entityId: sourceId }] }];
  const visited = new Set<string>();

  while (queue.length > 0 && results.length < 5) {
    const current = queue.shift()!;
    const lastNode = current.path[current.path.length - 1];

    if (lastNode.entityId === targetId && current.path.length > 1) {
      results.push(
        current.path.map((step) => ({
          entity: entityMap.get(step.entityId)!,
          relation: step.relation,
        })),
      );
      continue;
    }

    if (current.path.length >= maxDepth) continue;

    const neighbors = adjacency.get(lastNode.entityId) ?? [];
    for (const neighbor of neighbors) {
      if (
        !visited.has(neighbor.neighborId) ||
        neighbor.neighborId === targetId
      ) {
        queue.push({
          path: [
            ...current.path,
            { entityId: neighbor.neighborId, relation: neighbor.relation },
          ],
        });
      }
    }
    visited.add(lastNode.entityId);
  }

  return results;
}

/**
 * Export world model as Mermaid diagram.
 */
export function toMermaid(model: WorldModelType): string {
  const lines: string[] = [];
  if (model.name) {
    lines.push("---", `title: ${model.name}`, "---");
  }
  lines.push("graph TD");
  const entityMap = new Map(model.entities.map((e) => [e.id, e]));

  // Sanitize ID for Mermaid (no special chars)
  const mermaidId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
  const mermaidEscape = (s: string) =>
    s
      .replace(/"/g, "'")
      .replace(/`/g, "'")
      .replace(/[[\]{}()<>]/g, "")
      .replace(/\n/g, " ");

  // Add entity nodes with shape based on type
  for (const e of model.entities) {
    const mid = mermaidId(e.id);
    const label = mermaidEscape(e.name);
    switch (e.type) {
      case "actor":
        lines.push(`  ${mid}(["\`**${label}**\nactor\`"])`);
        break;
      case "system":
        lines.push(`  ${mid}[["${label}"]`);
        break;
      case "concept":
        lines.push(`  ${mid}>"${label}"]`);
        break;
      case "event":
        lines.push(`  ${mid}(("${label}"))`);
        break;
      default:
        lines.push(`  ${mid}["${label}"]`);
    }
  }

  // Add relation edges
  for (const r of model.relations) {
    const src = mermaidId(r.source);
    const tgt = mermaidId(r.target);
    const label = r.type.replace(/_/g, " ");
    if (r.bidirectional) {
      lines.push(`  ${src} <-- "${label}" --> ${tgt}`);
    } else {
      lines.push(`  ${src} -- "${label}" --> ${tgt}`);
    }
  }

  return lines.join("\n");
}

/**
 * Export world model as DOT (Graphviz) format.
 */
export function toDot(model: WorldModelType): string {
  const lines: string[] = [
    "digraph WorldModel {",
    "  rankdir=LR;",
    '  node [shape=box, style="rounded,filled", fillcolor="#f0f0f0", fontname="Helvetica"];',
    '  edge [fontname="Helvetica", fontsize=10];',
    "",
  ];

  const typeColors: Record<string, string> = {
    actor: "#d4edda",
    system: "#cce5ff",
    object: "#f0f0f0",
    concept: "#fff3cd",
    location: "#e2d5f1",
    event: "#f8d7da",
    group: "#d1ecf1",
    resource: "#ffeeba",
  };

  const dotEscape = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

  for (const e of model.entities) {
    const color = typeColors[e.type] ?? "#f0f0f0";
    const label = `${dotEscape(e.name)}\\n(${e.type})`;
    lines.push(`  "${e.id}" [label="${label}", fillcolor="${color}"];`);
  }

  lines.push("");

  for (const r of model.relations) {
    const label = r.type.replace(/_/g, " ");
    const dir = r.bidirectional ? ", dir=both" : "";
    lines.push(`  "${r.source}" -> "${r.target}" [label="${label}"${dir}];`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Get model statistics.
 */
export function getStats(model: WorldModelType) {
  const entityTypes = new Map<string, number>();
  for (const e of model.entities) {
    entityTypes.set(e.type, (entityTypes.get(e.type) ?? 0) + 1);
  }

  const relationTypes = new Map<string, number>();
  for (const r of model.relations) {
    relationTypes.set(r.type, (relationTypes.get(r.type) ?? 0) + 1);
  }

  // Find most connected entities
  const connectionCount = new Map<string, number>();
  for (const r of model.relations) {
    connectionCount.set(r.source, (connectionCount.get(r.source) ?? 0) + 1);
    connectionCount.set(r.target, (connectionCount.get(r.target) ?? 0) + 1);
  }

  const entityMap = new Map(model.entities.map((e) => [e.id, e]));
  const mostConnected = [...connectionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({
      entity: entityMap.get(id)?.name ?? id,
      connections: count,
    }));

  return {
    entities: {
      total: model.entities.length,
      byType: Object.fromEntries(entityTypes),
    },
    relations: {
      total: model.relations.length,
      byType: Object.fromEntries(relationTypes),
    },
    processes: {
      total: model.processes.length,
      totalSteps: model.processes.reduce((acc, p) => acc + p.steps.length, 0),
    },
    constraints: {
      total: model.constraints.length,
      hard: model.constraints.filter((c) => c.severity === "hard").length,
      soft: model.constraints.filter((c) => c.severity === "soft").length,
    },
    mostConnected,
    confidence: model.metadata?.confidence,
  };
}

/**
 * Extract a subgraph centered on an entity, including all entities within N hops.
 * Returns a new WorldModel containing only the reachable entities and their relations.
 */
export function subgraph(
  model: WorldModelType,
  centerId: string,
  maxHops = 2,
): WorldModelType {
  // BFS to find all reachable entity IDs within maxHops
  const reachable = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();
    for (const id of frontier) {
      for (const rel of model.relations) {
        if (rel.source === id && !reachable.has(rel.target)) {
          reachable.add(rel.target);
          nextFrontier.add(rel.target);
        }
        if (rel.target === id && !reachable.has(rel.source)) {
          reachable.add(rel.source);
          nextFrontier.add(rel.source);
        }
      }
    }
    frontier = nextFrontier;
  }

  const entities = model.entities.filter((e) => reachable.has(e.id));
  const relations = model.relations.filter(
    (r) => reachable.has(r.source) && reachable.has(r.target),
  );
  const processes = model.processes.filter((p) =>
    p.participants.some((pid) => reachable.has(pid)),
  );
  const constraints = model.constraints.filter((c) =>
    c.scope.some((sid) => reachable.has(sid)),
  );

  const centerName =
    model.entities.find((e) => e.id === centerId)?.name ?? centerId;

  return {
    id: model.id,
    name: `${model.name} — ${centerName} subgraph`,
    description: `Subgraph of ${model.name} centered on ${centerName} (${maxHops} hops)`,
    version: model.version,
    created_at: new Date().toISOString(),
    entities,
    relations,
    processes,
    constraints,
    metadata: {
      source_type: "mixed",
      source_summary: `Subgraph: ${entities.length} entities within ${maxHops} hops of ${centerName}`,
      confidence: model.metadata?.confidence ?? 0.5,
    },
  };
}

export interface Cluster {
  name: string;
  entities: Entity[];
  internalRelations: number;
  externalRelations: number;
}

/**
 * Find natural clusters in a world model using connected components
 * on strongly-connected subgraphs. Entities that are densely interconnected
 * get grouped together.
 */
export interface ImpactAnalysis {
  entity: Entity;
  brokenRelations: Relation[];
  affectedProcesses: Array<{
    process: WorldModelType["processes"][number];
    role: string;
  }>;
  affectedConstraints: WorldModelType["constraints"][number][];
  dependents: Entity[];
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
}

/**
 * Analyze the impact of removing an entity from the model.
 * "What breaks if we remove X?"
 */
export function analyzeImpact(
  model: WorldModelType,
  entityId: string,
): ImpactAnalysis | null {
  const entity = model.entities.find((e) => e.id === entityId);
  if (!entity) return null;

  // Relations that would break
  const brokenRelations = model.relations.filter(
    (r) => r.source === entityId || r.target === entityId,
  );

  // Processes that would lose a participant or step actor
  const affectedProcesses = model.processes
    .filter(
      (p) =>
        p.participants.includes(entityId) ||
        p.steps.some((s) => s.actor === entityId),
    )
    .map((p) => {
      const isActor = p.steps.some((s) => s.actor === entityId);
      return {
        process: p,
        role: isActor ? "step actor" : "participant",
      };
    });

  // Constraints that scope this entity
  const affectedConstraints = model.constraints.filter((c) =>
    c.scope.includes(entityId),
  );

  // Entities that depend on this one (via depends_on, part_of, etc.)
  const depTypes = new Set(["depends_on", "part_of", "uses", "consumes"]);
  const dependents = model.relations
    .filter((r) => r.target === entityId && depTypes.has(r.type))
    .map((r) => model.entities.find((e) => e.id === r.source)!)
    .filter(Boolean);

  // Compute severity
  const score =
    brokenRelations.length * 2 +
    affectedProcesses.length * 3 +
    affectedConstraints.filter((c) => c.severity === "hard").length * 5 +
    dependents.length * 2;

  const severity: ImpactAnalysis["severity"] =
    score >= 15
      ? "critical"
      : score >= 8
        ? "high"
        : score >= 3
          ? "medium"
          : "low";

  // Summary
  const parts: string[] = [`Removing ${entity.name} (${entity.type})`];
  if (brokenRelations.length > 0)
    parts.push(`breaks ${brokenRelations.length} relations`);
  if (dependents.length > 0)
    parts.push(`${dependents.length} entities depend on it`);
  if (affectedProcesses.length > 0)
    parts.push(`disrupts ${affectedProcesses.length} processes`);
  if (affectedConstraints.length > 0)
    parts.push(`invalidates ${affectedConstraints.length} constraints`);
  parts.push(`Severity: ${severity}.`);

  return {
    entity,
    brokenRelations,
    affectedProcesses,
    affectedConstraints,
    dependents,
    severity,
    summary: parts.join(". ") + ".",
  };
}

export function findClusters(model: WorldModelType): Cluster[] {
  if (model.entities.length === 0) return [];

  // Build undirected adjacency
  const adj = new Map<string, Set<string>>();
  for (const e of model.entities) adj.set(e.id, new Set());
  for (const r of model.relations) {
    adj.get(r.source)?.add(r.target);
    adj.get(r.target)?.add(r.source);
  }

  // Find connected components via BFS
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const entity of model.entities) {
    if (visited.has(entity.id)) continue;
    const component: string[] = [];
    const queue = [entity.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  const entityMap = new Map(model.entities.map((e) => [e.id, e]));

  return components
    .map((component) => {
      const entitySet = new Set(component);
      const entities = component
        .map((id) => entityMap.get(id)!)
        .filter(Boolean);

      const internalRelations = model.relations.filter(
        (r) => entitySet.has(r.source) && entitySet.has(r.target),
      ).length;

      const externalRelations = model.relations.filter(
        (r) =>
          (entitySet.has(r.source) || entitySet.has(r.target)) &&
          !(entitySet.has(r.source) && entitySet.has(r.target)),
      ).length;

      // Name the cluster after its most connected entity
      const connectionCounts = new Map<string, number>();
      for (const r of model.relations) {
        if (entitySet.has(r.source))
          connectionCounts.set(
            r.source,
            (connectionCounts.get(r.source) ?? 0) + 1,
          );
        if (entitySet.has(r.target))
          connectionCounts.set(
            r.target,
            (connectionCounts.get(r.target) ?? 0) + 1,
          );
      }
      const topEntity = [...connectionCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      const name = topEntity
        ? `${entityMap.get(topEntity[0])?.name ?? "Unknown"} cluster`
        : (entities[0]?.name ?? "Isolated");

      return { name, entities, internalRelations, externalRelations };
    })
    .sort((a, b) => b.entities.length - a.entities.length);
}

/**
 * Generate a natural-language summary of a world model. No LLM — pure graph analysis.
 */
export function summarize(model: WorldModelType): string {
  const stats = getStats(model);
  const parts: string[] = [];

  // What is it
  parts.push(model.description || model.name);

  // Scale
  const typeParts: string[] = [];
  for (const [type, count] of Object.entries(stats.entities.byType)) {
    typeParts.push(`${count} ${type}${count > 1 ? "s" : ""}`);
  }
  parts.push(
    `${stats.entities.total} entities (${typeParts.join(", ")}), ${stats.relations.total} relations.`,
  );

  // Center of gravity
  if (stats.mostConnected.length > 0) {
    const top = stats.mostConnected.slice(0, 3).map((mc) => mc.entity);
    parts.push(`Centered around ${top.join(", ")}.`);
  }

  // Processes
  if (stats.processes.total > 0) {
    const procNames = model.processes.map((p) => p.name).slice(0, 3);
    parts.push(
      `${stats.processes.total} process${stats.processes.total > 1 ? "es" : ""}: ${procNames.join(", ")}${model.processes.length > 3 ? ", ..." : ""}.`,
    );
  }

  // Constraints
  if (stats.constraints.total > 0) {
    const cParts: string[] = [];
    if (stats.constraints.hard > 0)
      cParts.push(`${stats.constraints.hard} hard`);
    if (stats.constraints.soft > 0)
      cParts.push(`${stats.constraints.soft} soft`);
    parts.push(
      `${stats.constraints.total} constraints (${cParts.join(", ")}).`,
    );
  }

  // Confidence
  if (stats.confidence !== undefined) {
    parts.push(`Confidence: ${Math.round(stats.confidence * 100)}%.`);
  }

  return parts.join(" ");
}
