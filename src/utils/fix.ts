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
