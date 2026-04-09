import type { WorldModelType } from "../schema/index.js";
import { genId } from "./ids.js";

// ─── Conflict detection ───────────────────────────────────────────────────────

export interface MergeConflict {
  entityName: string;
  field: "description" | "type";
  valueA: string;
  valueB: string;
}

/**
 * Detect conflicts between same-named entities in two models.
 * A conflict is when the same entity has different descriptions or types.
 * Returns an array of conflicts (empty if models are compatible).
 */
export function detectMergeConflicts(
  a: WorldModelType,
  b: WorldModelType,
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  function normalizeEntityName(name: string | undefined | null): string {
    return (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  const aMap = new Map<string, WorldModelType["entities"][number]>();
  for (const e of a.entities) {
    aMap.set(normalizeEntityName(e.name), e);
  }

  for (const eB of b.entities) {
    const key = normalizeEntityName(eB.name);
    const eA = aMap.get(key);
    if (!eA) continue;

    if (eA.type !== eB.type) {
      conflicts.push({
        entityName: eA.name,
        field: "type",
        valueA: eA.type,
        valueB: eB.type,
      });
    }

    if (eA.description !== eB.description) {
      conflicts.push({
        entityName: eA.name,
        field: "description",
        valueA: eA.description,
        valueB: eB.description,
      });
    }
  }

  return conflicts;
}

/**
 * Merge two world models into one. Deduplicates entities by name,
 * remaps all IDs, and unions relations/processes/constraints.
 */
export function mergeWorldModels(
  a: WorldModelType,
  b: WorldModelType,
  options?: { name?: string; description?: string },
): WorldModelType {
  // Build unified entity set, deduplicating by normalized name
  const entityMap = new Map<string, WorldModelType["entities"][number]>();
  const oldIdToNewId = new Map<string, string>();

  function normalizeEntityName(name: string | undefined | null): string {
    return (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function addEntity(e: WorldModelType["entities"][number]) {
    const key = normalizeEntityName(e.name);
    const existing = entityMap.get(key);
    if (existing) {
      oldIdToNewId.set(e.id, existing.id);
      // Merge properties and tags
      if (e.properties) {
        existing.properties = { ...existing.properties, ...e.properties };
      }
      if (e.tags) {
        const tagSet = new Set([...(existing.tags ?? []), ...e.tags]);
        existing.tags = [...tagSet];
      }
      // Keep the longer description
      if (e.description.length > existing.description.length) {
        existing.description = e.description;
      }
      // Boost confidence for cross-validated entities (appears in both models)
      const existingConf = existing.confidence ?? 0.5;
      const newConf = e.confidence ?? 0.5;
      existing.confidence = Math.min(1, (existingConf + newConf) / 2 + 0.1);
    } else {
      const newId = genId("ent");
      oldIdToNewId.set(e.id, newId);
      entityMap.set(key, { ...e, id: newId });
    }
  }

  for (const e of a.entities) addEntity(e);
  for (const e of b.entities) addEntity(e);

  const resolve = (oldId: string): string => oldIdToNewId.get(oldId) ?? oldId;

  // Merge relations, deduplicate by (source, target, type)
  const relationKey = (r: { source: string; target: string; type: string }) =>
    `${resolve(r.source)}::${r.type}::${resolve(r.target)}`;

  const relationMap = new Map<string, WorldModelType["relations"][number]>();

  for (const r of [...a.relations, ...b.relations]) {
    const key = relationKey(r);
    if (!relationMap.has(key)) {
      relationMap.set(key, {
        ...r,
        id: genId("rel"),
        source: resolve(r.source),
        target: resolve(r.target),
      });
    }
  }

  // Merge processes, deduplicate by normalized name
  const processMap = new Map<string, WorldModelType["processes"][number]>();

  for (const p of [...a.processes, ...b.processes]) {
    const key = normalizeEntityName(p.name);
    if (!processMap.has(key)) {
      processMap.set(key, {
        ...p,
        id: genId("proc"),
        participants: p.participants.map(resolve),
        steps: p.steps.map((s) => ({
          ...s,
          actor: s.actor ? resolve(s.actor) : undefined,
          input: s.input?.map(resolve),
          output: s.output?.map(resolve),
        })),
      });
    } else {
      // Keep the one with more steps
      const existing = processMap.get(key)!;
      if (p.steps.length > existing.steps.length) {
        processMap.set(key, {
          ...p,
          id: existing.id,
          participants: p.participants.map(resolve),
          steps: p.steps.map((s) => ({
            ...s,
            actor: s.actor ? resolve(s.actor) : undefined,
            input: s.input?.map(resolve),
            output: s.output?.map(resolve),
          })),
        });
      }
    }
  }

  // Merge constraints, deduplicate by normalized name
  const constraintMap = new Map<
    string,
    WorldModelType["constraints"][number]
  >();

  for (const c of [...a.constraints, ...b.constraints]) {
    const key = normalizeEntityName(c.name);
    if (!constraintMap.has(key)) {
      constraintMap.set(key, {
        ...c,
        id: genId("cstr"),
        scope: c.scope.map(resolve),
      });
    }
  }

  // Detect conflicts before returning
  const conflicts = detectMergeConflicts(a, b);
  const conflictNotes = conflicts.map(
    (c) =>
      `Conflict on "${c.entityName}" field "${c.field}": "${c.valueA}" vs "${c.valueB}" — kept A's value`,
  );

  // Compute merged confidence
  const confA = a.metadata?.confidence ?? 0.5;
  const confB = b.metadata?.confidence ?? 0.5;
  const mergedConfidence = Math.min(1, (confA + confB) / 2);

  return {
    id: genId("wm"),
    name: options?.name ?? `${a.name} + ${b.name}`,
    description:
      options?.description ?? `Merged model from: ${a.name}, ${b.name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [...entityMap.values()],
    relations: [...relationMap.values()],
    processes: [...processMap.values()],
    constraints: [...constraintMap.values()],
    metadata: {
      source_type: "mixed",
      source_summary: `Merged from ${a.entities.length + b.entities.length} entities across 2 models`,
      confidence: mergedConfidence,
      extraction_notes: [
        ...(a.metadata?.extraction_notes ?? []),
        ...(b.metadata?.extraction_notes ?? []),
        `Merged: ${a.name} (${a.entities.length} entities) + ${b.name} (${b.entities.length} entities)`,
        ...conflictNotes,
      ],
    },
  };
}

/**
 * Diff two world models. Returns what was added, removed, and changed.
 */
export interface WorldModelDiff {
  entities: {
    added: string[];
    removed: string[];
    modified: string[];
  };
  relations: {
    added: string[];
    removed: string[];
  };
  processes: {
    added: string[];
    removed: string[];
  };
  constraints: {
    added: string[];
    removed: string[];
  };
  summary: string;
}

export function diffWorldModels(
  before: WorldModelType,
  after: WorldModelType,
): WorldModelDiff {
  function nameSet(items: Array<{ name: string }>): Set<string> {
    return new Set(items.map((i) => i.name));
  }

  function descMap(
    items: Array<{ name: string; description: string }>,
  ): Map<string, string> {
    return new Map(items.map((i) => [i.name, i.description]));
  }

  const entBefore = nameSet(before.entities);
  const entAfter = nameSet(after.entities);
  const descBefore = descMap(before.entities);
  const descAfter = descMap(after.entities);

  const entAdded = [...entAfter].filter((n) => !entBefore.has(n));
  const entRemoved = [...entBefore].filter((n) => !entAfter.has(n));
  const entModified = [...entAfter].filter(
    (n) => entBefore.has(n) && descBefore.get(n) !== descAfter.get(n),
  );

  const relKey = (
    r: { source: string; target: string; type: string },
    model: WorldModelType,
  ) => {
    const src = model.entities.find((e) => e.id === r.source)?.name ?? r.source;
    const tgt = model.entities.find((e) => e.id === r.target)?.name ?? r.target;
    return `${src}::${r.type}::${tgt}`;
  };

  const relBefore = new Set(before.relations.map((r) => relKey(r, before)));
  const relAfter = new Set(after.relations.map((r) => relKey(r, after)));

  const procBefore = nameSet(before.processes);
  const procAfter = nameSet(after.processes);

  const cstrBefore = nameSet(before.constraints);
  const cstrAfter = nameSet(after.constraints);

  const diff: WorldModelDiff = {
    entities: {
      added: entAdded,
      removed: entRemoved,
      modified: entModified,
    },
    relations: {
      added: [...relAfter].filter((r) => !relBefore.has(r)),
      removed: [...relBefore].filter((r) => !relAfter.has(r)),
    },
    processes: {
      added: [...procAfter].filter((p) => !procBefore.has(p)),
      removed: [...procBefore].filter((p) => !procAfter.has(p)),
    },
    constraints: {
      added: [...cstrAfter].filter((c) => !cstrBefore.has(c)),
      removed: [...cstrBefore].filter((c) => !cstrAfter.has(c)),
    },
    summary: "",
  };

  const parts: string[] = [];
  if (entAdded.length) parts.push(`+${entAdded.length} entities`);
  if (entRemoved.length) parts.push(`-${entRemoved.length} entities`);
  if (entModified.length)
    parts.push(`~${entModified.length} entities modified`);
  if (diff.relations.added.length)
    parts.push(`+${diff.relations.added.length} relations`);
  if (diff.relations.removed.length)
    parts.push(`-${diff.relations.removed.length} relations`);
  if (diff.processes.added.length)
    parts.push(`+${diff.processes.added.length} processes`);
  if (diff.constraints.added.length)
    parts.push(`+${diff.constraints.added.length} constraints`);

  diff.summary = parts.length ? parts.join(", ") : "No changes";
  return diff;
}
