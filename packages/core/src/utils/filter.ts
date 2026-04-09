/**
 * Model filtering utilities.
 * Extract subsets of a world model by entity type, tag, confidence, or custom predicate.
 */

import type { WorldModelType } from "../schema/index.js";
import { genId } from "./ids.js";

export interface FilterOptions {
  /** Keep only entities matching these types */
  entityTypes?: string[];
  /** Keep only entities matching these tags (any match) */
  tags?: string[];
  /** Keep only entities with confidence >= threshold */
  minConfidence?: number;
  /** Keep only entities whose name or description contains this text (case-insensitive) */
  search?: string;
  /** Keep only hard or soft constraints */
  constraintSeverity?: "hard" | "soft";
  /** Custom entity predicate */
  entityPredicate?: (entity: WorldModelType["entities"][number]) => boolean;
}

/**
 * Filter a world model, returning a valid sub-model.
 * Relations, processes, and constraints are pruned to only reference
 * entities that survive the filter.
 */
export function filterModel(
  model: WorldModelType,
  options: FilterOptions,
): WorldModelType {
  // Filter entities
  let entities = [...model.entities];

  if (options.entityTypes?.length) {
    const types = new Set(options.entityTypes.map((t) => t.toLowerCase()));
    entities = entities.filter((e) => types.has(e.type));
  }

  if (options.tags?.length) {
    const tags = new Set(options.tags.map((t) => t.toLowerCase()));
    entities = entities.filter((e) =>
      e.tags?.some((t) => tags.has(t.toLowerCase())),
    );
  }

  if (options.minConfidence !== undefined) {
    const min = options.minConfidence;
    entities = entities.filter(
      (e) => e.confidence === undefined || e.confidence >= min,
    );
  }

  if (options.search) {
    const q = options.search.toLowerCase();
    entities = entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }

  if (options.entityPredicate) {
    entities = entities.filter(options.entityPredicate);
  }

  // Build surviving entity ID set
  const entityIds = new Set(entities.map((e) => e.id));

  // Filter relations — both source and target must survive
  const relations = model.relations.filter(
    (r) => entityIds.has(r.source) && entityIds.has(r.target),
  );

  // Filter processes — keep process if any participant survives,
  // prune participants/steps to surviving entities
  const processes = model.processes
    .map((p) => ({
      ...p,
      participants: p.participants.filter((pid) => entityIds.has(pid)),
      steps: p.steps.map((s) => ({
        ...s,
        actor: s.actor && entityIds.has(s.actor) ? s.actor : undefined,
        input: s.input?.filter((id) => entityIds.has(id)),
        output: s.output?.filter((id) => entityIds.has(id)),
      })),
    }))
    .filter((p) => p.participants.length > 0);

  // Filter constraints — keep if any scope entity survives
  let constraints = model.constraints
    .map((c) => ({
      ...c,
      scope: c.scope.filter((id) => entityIds.has(id)),
    }))
    .filter((c) => c.scope.length > 0);

  // Apply severity filter
  if (options.constraintSeverity) {
    constraints = constraints.filter(
      (c) => c.severity === options.constraintSeverity,
    );
  }

  return {
    ...model,
    id: genId("wm"),
    entities,
    relations,
    processes,
    constraints,
  };
}
