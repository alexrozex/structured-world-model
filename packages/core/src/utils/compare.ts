import type { WorldModelType } from "../schema/index.js";

export interface Conflict {
  kind:
    | "entity_type"
    | "relation_type"
    | "constraint_severity"
    | "constraint_scope"
    | "process_mismatch"
    | "description";
  element: string;
  modelA: string;
  modelB: string;
}

export interface CompareResult {
  conflicts: Conflict[];
  agreements: number;
  conflictRate: number;
  summary: string;
}

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Semantic comparison — find disagreements between two models of the same domain.
 * Same-named entities with different types, relations with different types, etc.
 */
export function compare(a: WorldModelType, b: WorldModelType): CompareResult {
  const conflicts: Conflict[] = [];
  let agreements = 0;

  // Entity type conflicts
  const aEntities = new Map(a.entities.map((e) => [normalize(e.name), e]));
  const bEntities = new Map(b.entities.map((e) => [normalize(e.name), e]));

  for (const [key, entA] of aEntities) {
    const entB = bEntities.get(key);
    if (!entB) continue;

    if (entA.type !== entB.type) {
      conflicts.push({
        kind: "entity_type",
        element: entA.name,
        modelA: entA.type,
        modelB: entB.type,
      });
    } else {
      agreements++;
    }
  }

  // Relation type conflicts (same source+target, different type)
  const relKey = (
    r: WorldModelType["relations"][number],
    model: WorldModelType,
  ) => {
    const src = normalize(
      model.entities.find((e) => e.id === r.source)?.name ?? r.source,
    );
    const tgt = normalize(
      model.entities.find((e) => e.id === r.target)?.name ?? r.target,
    );
    return `${src}::${tgt}`;
  };

  const aRels = new Map<string, WorldModelType["relations"][number]>();
  for (const r of a.relations) aRels.set(relKey(r, a), r);

  const bRels = new Map<string, WorldModelType["relations"][number]>();
  for (const r of b.relations) bRels.set(relKey(r, b), r);

  for (const [key, relA] of aRels) {
    const relB = bRels.get(key);
    if (!relB) continue;

    if (relA.type !== relB.type) {
      const src =
        a.entities.find((e) => e.id === relA.source)?.name ?? relA.source;
      const tgt =
        a.entities.find((e) => e.id === relA.target)?.name ?? relA.target;
      conflicts.push({
        kind: "relation_type",
        element: `${src} → ${tgt}`,
        modelA: relA.type,
        modelB: relB.type,
      });
    } else {
      agreements++;
    }
  }

  // Process comparison — step count, step actions, triggers
  const aProcs = new Map(a.processes.map((p) => [normalize(p.name), p]));
  const bProcs = new Map(b.processes.map((p) => [normalize(p.name), p]));

  for (const [key, pA] of aProcs) {
    const pB = bProcs.get(key);
    if (!pB) continue;

    let processConflict = false;

    // Different step counts
    if (pA.steps.length !== pB.steps.length) {
      conflicts.push({
        kind: "process_mismatch",
        element: pA.name,
        modelA: `${pA.steps.length} steps`,
        modelB: `${pB.steps.length} steps`,
      });
      processConflict = true;
    } else {
      // Same step count — compare actions by order
      const sortedA = [...pA.steps].sort((a, b) => a.order - b.order);
      const sortedB = [...pB.steps].sort((a, b) => a.order - b.order);
      for (let i = 0; i < sortedA.length; i++) {
        if (sortedA[i].action !== sortedB[i].action) {
          conflicts.push({
            kind: "process_mismatch",
            element: `${pA.name} step ${sortedA[i].order}`,
            modelA: sortedA[i].action,
            modelB: sortedB[i].action,
          });
          processConflict = true;
        }
      }
    }

    // Different triggers
    const trigA = pA.trigger ?? "";
    const trigB = pB.trigger ?? "";
    if (trigA !== trigB) {
      conflicts.push({
        kind: "process_mismatch",
        element: `${pA.name} trigger`,
        modelA: trigA || "(none)",
        modelB: trigB || "(none)",
      });
      processConflict = true;
    }

    if (!processConflict) {
      agreements++;
    }
  }

  // Constraint severity and scope conflicts
  const aCstrs = new Map(a.constraints.map((c) => [normalize(c.name), c]));
  const bCstrs = new Map(b.constraints.map((c) => [normalize(c.name), c]));

  for (const [key, cA] of aCstrs) {
    const cB = bCstrs.get(key);
    if (!cB) continue;

    let constraintConflict = false;

    if (cA.severity !== cB.severity) {
      conflicts.push({
        kind: "constraint_severity",
        element: cA.name,
        modelA: cA.severity,
        modelB: cB.severity,
      });
      constraintConflict = true;
    }

    // Scope comparison — resolve entity IDs to names for meaningful comparison
    const resolveScope = (scope: string[], model: WorldModelType): string[] => {
      return scope
        .map((id) =>
          normalize(model.entities.find((e) => e.id === id)?.name ?? id),
        )
        .sort();
    };

    const scopeA = resolveScope(cA.scope, a);
    const scopeB = resolveScope(cB.scope, b);
    const scopeAStr = scopeA.join(",");
    const scopeBStr = scopeB.join(",");

    if (scopeAStr !== scopeBStr) {
      conflicts.push({
        kind: "constraint_scope",
        element: cA.name,
        modelA: scopeA.join(", ") || "(empty)",
        modelB: scopeB.join(", ") || "(empty)",
      });
      constraintConflict = true;
    }

    if (!constraintConflict) {
      agreements++;
    }
  }

  const total = agreements + conflicts.length;
  const conflictRate =
    total > 0 ? Math.round((conflicts.length / total) * 100) / 100 : 0;

  const parts: string[] = [];
  if (conflicts.length === 0) {
    parts.push("No conflicts — models agree on all shared elements.");
  } else {
    parts.push(
      `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} found.`,
    );
    const byKind = new Map<string, number>();
    for (const c of conflicts)
      byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    for (const [kind, count] of byKind) {
      parts.push(
        `${count} ${kind.replace(/_/g, " ")} conflict${count > 1 ? "s" : ""}`,
      );
    }
  }
  parts.push(
    `${agreements} agreements, ${Math.round(conflictRate * 100)}% conflict rate.`,
  );

  return {
    conflicts,
    agreements,
    conflictRate,
    summary: parts.join(" "),
  };
}
