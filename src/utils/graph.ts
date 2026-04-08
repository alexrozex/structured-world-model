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
  const lines: string[] = ["graph TD"];
  const entityMap = new Map(model.entities.map((e) => [e.id, e]));

  // Sanitize ID for Mermaid (no special chars)
  const mermaidId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");

  // Add entity nodes with shape based on type
  for (const e of model.entities) {
    const mid = mermaidId(e.id);
    const label = e.name.replace(/"/g, "'");
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

  for (const e of model.entities) {
    const color = typeColors[e.type] ?? "#f0f0f0";
    const label = `${e.name}\\n(${e.type})`;
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
