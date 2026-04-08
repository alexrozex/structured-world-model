import type {
  WorldModelType,
  ValidationResultType,
  ValidationIssueType,
} from "../schema/index.js";
import type { PipelineInput } from "../pipeline/index.js";

export interface ValidationOutput {
  worldModel: WorldModelType;
  validation: ValidationResultType;
}

export function validationAgent(stageInput: {
  input: PipelineInput;
  worldModel: WorldModelType;
}): Promise<ValidationOutput> {
  const { worldModel } = stageInput;
  const issues: ValidationIssueType[] = [];

  const entityIds = new Set(worldModel.entities.map((e) => e.id));

  // Check relations reference valid entities
  for (const rel of worldModel.relations) {
    if (!entityIds.has(rel.source)) {
      issues.push({
        type: "error",
        code: "DANGLING_REL_SOURCE",
        message: `Relation "${rel.id}" references non-existent source entity "${rel.source}"`,
        path: `relations.${rel.id}.source`,
      });
    }
    if (!entityIds.has(rel.target)) {
      issues.push({
        type: "error",
        code: "DANGLING_REL_TARGET",
        message: `Relation "${rel.id}" references non-existent target entity "${rel.target}"`,
        path: `relations.${rel.id}.target`,
      });
    }
    if (rel.source === rel.target) {
      issues.push({
        type: "warning",
        code: "SELF_RELATION",
        message: `Relation "${rel.id}" is a self-reference on entity "${rel.source}"`,
        path: `relations.${rel.id}`,
      });
    }
  }

  // Check processes reference valid entities
  for (const proc of worldModel.processes) {
    for (const participant of proc.participants) {
      if (!entityIds.has(participant)) {
        issues.push({
          type: "error",
          code: "DANGLING_PROC_PARTICIPANT",
          message: `Process "${proc.name}" references non-existent participant "${participant}"`,
          path: `processes.${proc.id}.participants`,
        });
      }
    }
    for (const step of proc.steps) {
      if (step.actor && !entityIds.has(step.actor)) {
        issues.push({
          type: "error",
          code: "DANGLING_STEP_ACTOR",
          message: `Process "${proc.name}" step ${step.order} references non-existent actor "${step.actor}"`,
          path: `processes.${proc.id}.steps.${step.order}.actor`,
        });
      }
    }
    if (proc.steps.length === 0) {
      issues.push({
        type: "warning",
        code: "EMPTY_PROCESS",
        message: `Process "${proc.name}" has no steps`,
        path: `processes.${proc.id}.steps`,
      });
    }

    // Check step ordering
    if (proc.steps.length > 1) {
      const orders = proc.steps.map((s) => s.order);
      const hasDuplicates = new Set(orders).size !== orders.length;
      if (hasDuplicates) {
        issues.push({
          type: "warning",
          code: "DUPLICATE_STEP_ORDER",
          message: `Process "${proc.name}" has duplicate step order numbers: [${orders.join(", ")}]`,
          path: `processes.${proc.id}.steps`,
        });
      }
      const sorted = [...orders].sort((a, b) => a - b);
      const isMonotonic = orders.every((o, i) => o === sorted[i]);
      if (!isMonotonic) {
        issues.push({
          type: "warning",
          code: "UNORDERED_STEPS",
          message: `Process "${proc.name}" steps are not in ascending order: [${orders.join(", ")}]`,
          path: `processes.${proc.id}.steps`,
        });
      }
    }
  }

  // Check constraints reference valid entities
  for (const constraint of worldModel.constraints) {
    for (const scopeId of constraint.scope) {
      if (!entityIds.has(scopeId)) {
        issues.push({
          type: "error",
          code: "DANGLING_CONSTRAINT_SCOPE",
          message: `Constraint "${constraint.name}" references non-existent entity "${scopeId}"`,
          path: `constraints.${constraint.id}.scope`,
        });
      }
    }
  }

  // Check for orphan entities (no relations, not in any process)
  const referencedEntities = new Set<string>();
  for (const rel of worldModel.relations) {
    referencedEntities.add(rel.source);
    referencedEntities.add(rel.target);
  }
  for (const proc of worldModel.processes) {
    for (const p of proc.participants) referencedEntities.add(p);
  }
  for (const constraint of worldModel.constraints) {
    for (const s of constraint.scope) referencedEntities.add(s);
  }

  for (const entity of worldModel.entities) {
    if (!referencedEntities.has(entity.id)) {
      issues.push({
        type: "warning",
        code: "ORPHAN_ENTITY",
        message: `Entity "${entity.name}" (${entity.id}) is not referenced by any relation, process, or constraint`,
        path: `entities.${entity.id}`,
      });
    }
  }

  // Check for weak entity descriptions
  for (const entity of worldModel.entities) {
    if (!entity.description || entity.description.trim().length < 5) {
      issues.push({
        type: "warning",
        code: "WEAK_DESCRIPTION",
        message: `Entity "${entity.name}" has a missing or trivially short description`,
        path: `entities.${entity.id}.description`,
      });
    }
  }

  // Check for duplicate entity names
  const nameCount = new Map<string, number>();
  for (const entity of worldModel.entities) {
    nameCount.set(entity.name, (nameCount.get(entity.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCount) {
    if (count > 1) {
      issues.push({
        type: "warning",
        code: "DUPLICATE_ENTITY_NAME",
        message: `Entity name "${name}" appears ${count} times — may indicate extraction duplication`,
        path: `entities`,
      });
    }
  }

  // Check for circular dependencies (A depends_on B, B depends_on A)
  const depTypes = new Set(["depends_on", "part_of", "contains", "inherits"]);
  const depEdges = worldModel.relations.filter((r) => depTypes.has(r.type));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function detectCycle(entityId: string, path: string[]): boolean {
    if (inStack.has(entityId)) {
      const cycleStart = path.indexOf(entityId);
      const cycle = path.slice(cycleStart);
      const cycleNames = cycle.map(
        (id) => worldModel.entities.find((e) => e.id === id)?.name ?? id,
      );
      issues.push({
        type: "warning",
        code: "CIRCULAR_DEPENDENCY",
        message: `Circular dependency detected: ${cycleNames.join(" → ")} → ${cycleNames[0]}`,
        path: `relations`,
      });
      return true;
    }
    if (visited.has(entityId)) return false;
    visited.add(entityId);
    inStack.add(entityId);
    for (const edge of depEdges) {
      if (edge.source === entityId) {
        detectCycle(edge.target, [...path, entityId]);
      }
    }
    inStack.delete(entityId);
    return false;
  }

  for (const entity of worldModel.entities) {
    if (!visited.has(entity.id)) {
      detectCycle(entity.id, []);
    }
  }

  // Completeness checks
  if (worldModel.entities.length === 0) {
    issues.push({
      type: "error",
      code: "NO_ENTITIES",
      message: "World model has no entities",
    });
  }
  if (worldModel.relations.length === 0) {
    issues.push({
      type: "warning",
      code: "NO_RELATIONS",
      message: "World model has no relations — entities are unconnected",
    });
  }

  // Check for low type diversity (one type dominates > 80% of entities)
  if (worldModel.entities.length >= 5) {
    const typeCounts = new Map<string, number>();
    for (const e of worldModel.entities) {
      typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
    }
    for (const [type, count] of typeCounts) {
      const pct = count / worldModel.entities.length;
      if (pct > 0.8) {
        issues.push({
          type: "warning",
          code: "LOW_TYPE_DIVERSITY",
          message: `${Math.round(pct * 100)}% of entities are type "${type}" (${count}/${worldModel.entities.length}) — may indicate poor type classification`,
          path: "entities",
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.type === "error");

  // Compute quality score (0-100)
  let score = 100;

  // Penalize errors (-15 each) and warnings (-3 each)
  const errors = issues.filter((i) => i.type === "error").length;
  const warnings = issues.filter((i) => i.type === "warning").length;
  score -= errors * 15;
  score -= warnings * 3;

  // Reward completeness: having all four element types
  if (worldModel.entities.length === 0) score -= 20;
  if (worldModel.relations.length === 0) score -= 10;
  if (worldModel.processes.length === 0) score -= 5;
  if (worldModel.constraints.length === 0) score -= 5;

  // Reward relation density (relations / entities ratio — ideal ~1.0+)
  if (worldModel.entities.length > 0) {
    const density = worldModel.relations.length / worldModel.entities.length;
    if (density < 0.5) score -= 10;
    else if (density >= 1.0) score += 5;
  }

  // Reward confidence
  const conf = worldModel.metadata?.confidence ?? 0.5;
  score += Math.round((conf - 0.5) * 10); // +/-5 based on confidence

  score = Math.max(0, Math.min(100, score));

  const validation: ValidationResultType = {
    valid: !hasErrors,
    issues,
    stats: {
      entities: worldModel.entities.length,
      relations: worldModel.relations.length,
      processes: worldModel.processes.length,
      constraints: worldModel.constraints.length,
    },
    score,
  };

  return Promise.resolve({ worldModel, validation });
}
