import type { WorldModelType, ValidationIssueType } from "../schema/index.js";

export interface FixResult {
  model: WorldModelType;
  fixes: string[];
}

/**
 * Auto-fix common validation issues in a world model.
 * Returns a cleaned model and a list of what was fixed.
 */
export function fixWorldModel(model: WorldModelType): FixResult {
  const fixes: string[] = [];
  let entities = [...model.entities];
  let relations = [...model.relations];
  let processes = [...model.processes];
  let constraints = [...model.constraints];

  const entityIds = () => new Set(entities.map((e) => e.id));

  // Fix 0: Merge duplicate entities FIRST (before orphan removal eats them)
  {
    const normalize = (n: string) => n.toLowerCase().trim();
    const nameGroups = new Map<string, typeof entities>();
    for (const e of entities) {
      const key = normalize(e.name);
      const group = nameGroups.get(key) ?? [];
      group.push(e);
      nameGroups.set(key, group);
    }

    let mergedCount = 0;
    const idRemap = new Map<string, string>();
    const deduped: typeof entities = [];

    for (const group of nameGroups.values()) {
      if (group.length === 1) {
        deduped.push(group[0]);
        continue;
      }
      const keeper = group.reduce((a, b) =>
        (b.description?.length ?? 0) > (a.description?.length ?? 0) ? b : a,
      );
      for (const e of group) {
        if (e.id !== keeper.id) {
          idRemap.set(e.id, keeper.id);
          if (e.properties)
            keeper.properties = { ...keeper.properties, ...e.properties };
          if (e.tags)
            keeper.tags = [...new Set([...(keeper.tags ?? []), ...e.tags])];
        }
      }
      deduped.push(keeper);
      mergedCount += group.length - 1;
    }

    if (mergedCount > 0) {
      entities = deduped;
      const remap = (id: string) => idRemap.get(id) ?? id;
      relations = relations.map((r) => ({
        ...r,
        source: remap(r.source),
        target: remap(r.target),
      }));
      processes = processes.map((p) => ({
        ...p,
        participants: p.participants.map(remap),
        steps: p.steps.map((s) => ({
          ...s,
          actor: s.actor ? remap(s.actor) : undefined,
        })),
      }));
      constraints = constraints.map((c) => ({
        ...c,
        scope: c.scope.map(remap),
      }));
      fixes.push(`Merged ${mergedCount} duplicate entities`);
    }
  }

  // Fix 0b: Remove low-confidence placeholder entities (auto-created by structuring)
  // Also removes entities whose descriptions indicate they're unresolved references
  {
    const before = entities.length;
    const removedIds = new Set<string>();
    entities = entities.filter((e) => {
      // Tag-based: low confidence + auto-created tag
      if (
        e.confidence !== undefined &&
        e.confidence <= 0.2 &&
        e.tags?.includes("auto-created")
      ) {
        removedIds.add(e.id);
        return false;
      }
      // Description-based: auto-created for unresolved reference
      if (
        e.description
          .toLowerCase()
          .includes("auto-created entity for unresolved reference")
      ) {
        removedIds.add(e.id);
        return false;
      }
      // Name-based: entities that look like variable names or return types (code extraction noise)
      // e.g. "incoming relations array", "broken relations list", "result object"
      const noisyPatterns =
        /^(incoming|outgoing|broken|result|return|input|output|temp|local|internal)\s+(relations?|objects?|arrays?|lists?|values?|items?|data|types?|variables?)\b/i;
      if (
        noisyPatterns.test(e.name) &&
        (e.confidence === undefined || e.confidence < 0.5)
      ) {
        removedIds.add(e.id);
        return false;
      }
      return true;
    });
    if (removedIds.size > 0) {
      // Clean references to removed placeholders
      relations = relations.filter(
        (r) => !removedIds.has(r.source) && !removedIds.has(r.target),
      );
      processes = processes.map((p) => ({
        ...p,
        participants: p.participants.filter((pid) => !removedIds.has(pid)),
        steps: p.steps.map((s) => ({
          ...s,
          actor: s.actor && removedIds.has(s.actor) ? undefined : s.actor,
          input: s.input?.filter((id) => !removedIds.has(id)),
          output: s.output?.filter((id) => !removedIds.has(id)),
        })),
      }));
      constraints = constraints.map((c) => ({
        ...c,
        scope: c.scope.filter((id) => !removedIds.has(id)),
      }));
      fixes.push(
        `Removed ${removedIds.size} low-confidence placeholder entities`,
      );
    }
  }

  // Fix 1: Remove relations with dangling source or target
  {
    const ids = entityIds();
    const before = relations.length;
    relations = relations.filter((r) => ids.has(r.source) && ids.has(r.target));
    const removed = before - relations.length;
    if (removed > 0)
      fixes.push(`Removed ${removed} relations with dangling references`);
  }

  // Fix 2: Remove self-referencing relations
  {
    const before = relations.length;
    relations = relations.filter((r) => r.source !== r.target);
    const removed = before - relations.length;
    if (removed > 0)
      fixes.push(`Removed ${removed} self-referencing relations`);
  }

  // Fix 3: Remove orphan entities (not referenced by any relation, process, or constraint)
  {
    const referenced = new Set<string>();
    for (const r of relations) {
      referenced.add(r.source);
      referenced.add(r.target);
    }
    for (const p of processes) {
      for (const pid of p.participants) referenced.add(pid);
      for (const s of p.steps) {
        if (s.actor) referenced.add(s.actor);
        for (const inp of s.input ?? []) referenced.add(inp);
        for (const out of s.output ?? []) referenced.add(out);
      }
    }
    for (const c of constraints) {
      for (const sid of c.scope) referenced.add(sid);
    }

    const before = entities.length;
    entities = entities.filter((e) => referenced.has(e.id));
    const removed = before - entities.length;
    if (removed > 0) fixes.push(`Removed ${removed} orphan entities`);
  }

  // Fix 4: Remove process participants that reference non-existent entities
  {
    const ids = entityIds();
    let fixedCount = 0;
    processes = processes.map((p) => {
      const validParticipants = p.participants.filter((pid) => ids.has(pid));
      if (validParticipants.length < p.participants.length) fixedCount++;
      return { ...p, participants: validParticipants };
    });
    if (fixedCount > 0)
      fixes.push(`Cleaned dangling participants in ${fixedCount} processes`);
  }

  // Fix 5: Remove constraint scopes that reference non-existent entities
  {
    const ids = entityIds();
    let fixedCount = 0;
    constraints = constraints.map((c) => {
      const validScope = c.scope.filter((sid) => ids.has(sid));
      if (validScope.length < c.scope.length) fixedCount++;
      return { ...c, scope: validScope };
    });
    if (fixedCount > 0)
      fixes.push(`Cleaned dangling scope in ${fixedCount} constraints`);
  }

  // Fix 6: Remove empty processes (no steps)
  {
    const before = processes.length;
    processes = processes.filter((p) => p.steps.length > 0);
    const removed = before - processes.length;
    if (removed > 0) fixes.push(`Removed ${removed} empty processes`);
  }

  // Fix 7: Sort process steps by order
  {
    let fixedCount = 0;
    processes = processes.map((p) => {
      const sorted = [...p.steps].sort((a, b) => a.order - b.order);
      const wasUnsorted = p.steps.some((s, i) => s.order !== sorted[i].order);
      if (wasUnsorted) fixedCount++;
      return { ...p, steps: sorted };
    });
    if (fixedCount > 0) fixes.push(`Sorted steps in ${fixedCount} processes`);
  }

  // Fix 8: Deduplicate relations (same source, type, target)
  {
    const seen = new Set<string>();
    const before = relations.length;
    relations = relations.filter((r) => {
      const key = `${r.source}::${r.type}::${r.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removed = before - relations.length;
    if (removed > 0) fixes.push(`Removed ${removed} duplicate relations`);
  }

  // Fix 9: Clear dangling step actors
  {
    const ids = entityIds();
    let fixedCount = 0;
    processes = processes.map((p) => ({
      ...p,
      steps: p.steps.map((s) => {
        if (s.actor && !ids.has(s.actor)) {
          fixedCount++;
          return { ...s, actor: undefined };
        }
        return s;
      }),
    }));
    if (fixedCount > 0)
      fixes.push(`Cleared ${fixedCount} dangling step actors`);
  }

  // Fix 10: Renumber duplicate step orders sequentially
  {
    let fixedCount = 0;
    processes = processes.map((p) => {
      const orders = p.steps.map((s) => s.order);
      const hasDupes = new Set(orders).size !== orders.length;
      if (hasDupes) {
        fixedCount++;
        return { ...p, steps: p.steps.map((s, i) => ({ ...s, order: i + 1 })) };
      }
      return p;
    });
    if (fixedCount > 0)
      fixes.push(
        `Renumbered steps in ${fixedCount} processes with duplicate orders`,
      );
  }

  return {
    model: { ...model, entities, relations, processes, constraints },
    fixes,
  };
}
