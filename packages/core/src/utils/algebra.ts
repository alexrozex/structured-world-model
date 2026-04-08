import type { WorldModelType } from "../schema/index.js";
import { genId } from "./ids.js";

type Entity = WorldModelType["entities"][number];
type Relation = WorldModelType["relations"][number];

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function entityKey(e: Entity): string {
  return normalizeKey(e.name);
}

function relKey(r: Relation, model: WorldModelType): string {
  const src = model.entities.find((e) => e.id === r.source)?.name ?? r.source;
  const tgt = model.entities.find((e) => e.id === r.target)?.name ?? r.target;
  return `${normalizeKey(src)}::${r.type}::${normalizeKey(tgt)}`;
}

function procKey(p: WorldModelType["processes"][number]): string {
  return normalizeKey(p.name);
}

function cstrKey(c: WorldModelType["constraints"][number]): string {
  return normalizeKey(c.name);
}

/**
 * Intersection: entities, relations, processes, constraints that appear in BOTH models.
 * Matched by name (entities, processes, constraints) or by (source, type, target) for relations.
 */
export function intersection(
  a: WorldModelType,
  b: WorldModelType,
): WorldModelType {
  const bEntityKeys = new Set(b.entities.map(entityKey));
  const bRelKeys = new Set(b.relations.map((r) => relKey(r, b)));
  const bProcKeys = new Set(b.processes.map(procKey));
  const bCstrKeys = new Set(b.constraints.map(cstrKey));

  const entities = a.entities
    .filter((e) => bEntityKeys.has(entityKey(e)))
    .map((e) => ({ ...e, id: genId("ent") }));

  const entityIdMap = new Map<string, string>();
  for (const origE of a.entities) {
    const newE = entities.find((e) => entityKey(e) === entityKey(origE));
    if (newE) entityIdMap.set(origE.id, newE.id);
  }
  // Also map B's IDs
  for (const origE of b.entities) {
    const newE = entities.find((e) => entityKey(e) === entityKey(origE));
    if (newE) entityIdMap.set(origE.id, newE.id);
  }

  const resolve = (id: string) => entityIdMap.get(id) ?? id;

  const relations = a.relations
    .filter((r) => bRelKeys.has(relKey(r, a)))
    .map((r) => ({
      ...r,
      id: genId("rel"),
      source: resolve(r.source),
      target: resolve(r.target),
    }));

  const processes = a.processes
    .filter((p) => bProcKeys.has(procKey(p)))
    .map((p) => ({
      ...p,
      id: genId("proc"),
      participants: p.participants.map(resolve),
      steps: p.steps.map((s) => ({
        ...s,
        actor: s.actor ? resolve(s.actor) : undefined,
        input: s.input?.map(resolve),
        output: s.output?.map(resolve),
      })),
    }));

  const constraints = a.constraints
    .filter((c) => bCstrKeys.has(cstrKey(c)))
    .map((c) => ({ ...c, id: genId("cstr"), scope: c.scope.map(resolve) }));

  return {
    id: genId("wm"),
    name: `${a.name} ∩ ${b.name}`,
    description: `Intersection of ${a.name} and ${b.name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations,
    processes,
    constraints,
    metadata: {
      source_type: "mixed",
      source_summary: `Intersection: ${entities.length} shared entities`,
      confidence: Math.min(
        a.metadata?.confidence ?? 0.5,
        b.metadata?.confidence ?? 0.5,
      ),
    },
  };
}

/**
 * Difference: entities in A that are NOT in B.
 * Relations, processes, constraints are kept only if all their entity references remain.
 */
export function difference(
  a: WorldModelType,
  b: WorldModelType,
): WorldModelType {
  const bEntityKeys = new Set(b.entities.map(entityKey));

  const entities = a.entities
    .filter((e) => !bEntityKeys.has(entityKey(e)))
    .map((e) => ({ ...e, id: genId("ent") }));

  const entityIdMap = new Map<string, string>();
  for (const origE of a.entities) {
    const newE = entities.find((ne) => entityKey(ne) === entityKey(origE));
    if (newE) entityIdMap.set(origE.id, newE.id);
  }

  const remainingIds = new Set(entities.map((e) => e.id));
  const resolve = (id: string) => entityIdMap.get(id) ?? id;

  // Keep relations only if both endpoints remain
  const relations = a.relations
    .filter((r) => {
      const src = resolve(r.source);
      const tgt = resolve(r.target);
      return remainingIds.has(src) && remainingIds.has(tgt);
    })
    .map((r) => ({
      ...r,
      id: genId("rel"),
      source: resolve(r.source),
      target: resolve(r.target),
    }));

  // Keep processes only if all participants remain
  const processes = a.processes
    .filter((p) =>
      p.participants.every((pid) => remainingIds.has(resolve(pid))),
    )
    .map((p) => ({
      ...p,
      id: genId("proc"),
      participants: p.participants.map(resolve),
      steps: p.steps.map((s) => ({
        ...s,
        actor: s.actor ? resolve(s.actor) : undefined,
        input: s.input?.map(resolve),
        output: s.output?.map(resolve),
      })),
    }));

  // Keep constraints only if all scope entities remain
  const constraints = a.constraints
    .filter((c) => c.scope.every((sid) => remainingIds.has(resolve(sid))))
    .map((c) => ({ ...c, id: genId("cstr"), scope: c.scope.map(resolve) }));

  return {
    id: genId("wm"),
    name: `${a.name} \\ ${b.name}`,
    description: `Entities in ${a.name} but not in ${b.name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations,
    processes,
    constraints,
    metadata: {
      source_type: "mixed",
      source_summary: `Difference: ${entities.length} entities unique to ${a.name}`,
      confidence: a.metadata?.confidence ?? 0.5,
    },
  };
}

/**
 * Overlay: apply B as a "lens" on top of A.
 * - All of A's entities remain
 * - B's constraints and relations are applied to matching entities in A
 * - B's entities that don't exist in A are added
 * - B's constraints override A's constraints with the same name
 */
export function overlay(
  base: WorldModelType,
  lens: WorldModelType,
): WorldModelType {
  // Start with all of base's entities
  const entityIdMap = new Map<string, string>();
  const entities: Entity[] = base.entities.map((e) => {
    const newId = genId("ent");
    entityIdMap.set(e.id, newId);
    return { ...e, id: newId };
  });

  // Map lens entities to base entities by name, or add new ones
  for (const le of lens.entities) {
    const key = entityKey(le);
    const existing = entities.find((e) => entityKey(e) === key);
    if (existing) {
      entityIdMap.set(le.id, existing.id);
      // Merge lens properties onto base
      if (le.properties) {
        existing.properties = { ...existing.properties, ...le.properties };
      }
      if (le.tags) {
        existing.tags = [...new Set([...(existing.tags ?? []), ...le.tags])];
      }
    } else {
      const newId = genId("ent");
      entityIdMap.set(le.id, newId);
      entities.push({ ...le, id: newId });
    }
  }

  const resolve = (id: string) => entityIdMap.get(id) ?? id;

  // Union all relations, dedup by (source, type, target)
  const relSeen = new Set<string>();
  const relations: Relation[] = [];

  for (const r of [...base.relations, ...lens.relations]) {
    const src = resolve(r.source);
    const tgt = resolve(r.target);
    const key = `${src}::${r.type}::${tgt}`;
    if (!relSeen.has(key)) {
      relSeen.add(key);
      relations.push({ ...r, id: genId("rel"), source: src, target: tgt });
    }
  }

  // Union processes, lens takes precedence for same name
  const procMap = new Map<string, WorldModelType["processes"][number]>();
  for (const p of base.processes) {
    procMap.set(procKey(p), {
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
  }
  for (const p of lens.processes) {
    procMap.set(procKey(p), {
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
  }

  // Constraints: lens overrides base for same name
  const cstrMap = new Map<string, WorldModelType["constraints"][number]>();
  for (const c of base.constraints) {
    cstrMap.set(cstrKey(c), {
      ...c,
      id: genId("cstr"),
      scope: c.scope.map(resolve),
    });
  }
  for (const c of lens.constraints) {
    cstrMap.set(cstrKey(c), {
      ...c,
      id: genId("cstr"),
      scope: c.scope.map(resolve),
    });
  }

  return {
    id: genId("wm"),
    name: `${base.name} + ${lens.name}`,
    description: `${base.name} with ${lens.name} overlay applied`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations,
    processes: [...procMap.values()],
    constraints: [...cstrMap.values()],
    metadata: {
      source_type: "mixed",
      source_summary: `Overlay: ${base.name} (base) + ${lens.name} (lens)`,
      confidence: Math.min(
        base.metadata?.confidence ?? 0.5,
        lens.metadata?.confidence ?? 0.5,
      ),
    },
  };
}
