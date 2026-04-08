/**
 * Bridge: composes SWM extraction with Ada compilation.
 *
 * SWM extracts descriptive world models (entities, relations, processes, constraints).
 * Ada compiles prescriptive blueprints (invariants, Hoare triples, bounded contexts).
 * This module maps between them.
 */

import type {
  WorldModelType,
  EntityType as SwmEntity,
  ProcessType as SwmProcess,
  ConstraintType as SwmConstraint,
} from "@swm/core";

import type {
  Entity as AdaEntity,
  EntityProperty,
  EntityInvariant,
  EntityMap,
  BoundedContext,
  Workflow,
  WorkflowStep,
  HoareTriple,
  ProcessFlow,
  StateMachine,
  Blueprint,
  GovernorDecision,
  CompilationAudit,
  Challenge,
  NonFunctionalRequirement,
  BuildContract,
} from "@swm/compiler";

import type { PostcodeAddress } from "@swm/provenance";

import type { EnrichedWorldModel } from "./enriched-model.js";

// ─── SWM Entity Type → Ada Entity Category ─────────────────────

const ENTITY_TYPE_MAP: Record<SwmEntity["type"], AdaEntity["category"]> = {
  actor: "substance",
  group: "substance",
  object: "substance",
  resource: "substance",
  system: "substance",
  concept: "quality",
  event: "event",
  location: "state",
};

// ─── SWM Constraint → Ada EntityInvariant ───────────────────────

function constraintToInvariant(c: SwmConstraint): EntityInvariant {
  return {
    predicate: `${c.name}: ${c.description}`,
    description: `[${c.severity}] ${c.description}`,
  };
}

// ─── SWM Entity → Ada Entity ────────────────────────────────────

function swmEntityToAdaEntity(e: SwmEntity): AdaEntity {
  const properties: EntityProperty[] = [];
  if (e.properties) {
    for (const [name, value] of Object.entries(e.properties)) {
      properties.push({
        name,
        type: typeof value === "string" ? value : String(value),
        required: true,
      });
    }
  }

  return {
    name: e.name,
    category: ENTITY_TYPE_MAP[e.type] ?? "substance",
    properties,
    invariants: [], // populated from constraints in seed step
  };
}

// ─── SWM Process → Ada Workflow ─────────────────────────────────

function swmProcessToAdaWorkflow(
  proc: SwmProcess,
  entityNames: Map<string, string>,
): Workflow {
  const steps: WorkflowStep[] = proc.steps.map((step, i) => {
    const prevStep = i > 0 ? proc.steps[i - 1] : null;
    const nextStep = i < proc.steps.length - 1 ? proc.steps[i + 1] : null;

    const hoareTriple: HoareTriple = {
      precondition: prevStep
        ? `Step "${prevStep.action}" completed`
        : (proc.trigger ?? "Process initiated"),
      action: step.action,
      postcondition: nextStep
        ? `Ready for "${nextStep.action}"`
        : "Process outcome achieved",
    };

    return {
      name: `step-${step.order}`,
      hoareTriple,
      failureModes: [],
      temporalRelation: "enables" as const,
    };
  });

  return {
    name: proc.name,
    trigger: proc.trigger ?? "manual",
    steps,
  };
}

// ─── WorldModel → Compiler Seed ─────────────────────────────────

export interface CompilerSeed {
  entitySeed: Partial<EntityMap>;
  processSeed: Partial<ProcessFlow>;
  constraintsByEntity: Map<string, EntityInvariant[]>;
}

/**
 * Convert a SWM WorldModel into seed context for Ada's compiler.
 * The seed pre-populates entities, processes, and constraints so the
 * compiler's ENT/PRO stages can enrich rather than re-discover.
 */
export function worldModelToCompilerSeed(model: WorldModelType): CompilerSeed {
  // Build entity name → id lookup
  const entityIdToName = new Map<string, string>();
  for (const e of model.entities) {
    entityIdToName.set(e.id, e.name);
  }

  // Map entities
  const adaEntities: AdaEntity[] = model.entities.map(swmEntityToAdaEntity);

  // Map constraints to entity invariants
  const constraintsByEntity = new Map<string, EntityInvariant[]>();
  for (const c of model.constraints) {
    const inv = constraintToInvariant(c);
    for (const scopeId of c.scope) {
      const entityName = entityIdToName.get(scopeId);
      if (entityName) {
        const existing = constraintsByEntity.get(entityName) ?? [];
        existing.push(inv);
        constraintsByEntity.set(entityName, existing);
      }
    }
  }

  // Apply invariants to entities
  const entitiesWithInvariants = adaEntities.map((e) => ({
    ...e,
    invariants: [...e.invariants, ...(constraintsByEntity.get(e.name) ?? [])],
  }));

  // Infer bounded contexts from clusters (entities connected by relations)
  const boundedContexts: BoundedContext[] = inferBoundedContexts(
    model,
    entitiesWithInvariants,
    constraintsByEntity,
  );

  // Map processes to workflows
  const workflows = model.processes.map((p) =>
    swmProcessToAdaWorkflow(p, entityIdToName),
  );

  return {
    entitySeed: {
      entities: entitiesWithInvariants,
      boundedContexts,
      challenges: [],
    },
    processSeed: {
      workflows,
      stateMachines: [],
      challenges: [],
    },
    constraintsByEntity,
  };
}

// ─── Bounded Context Inference ──────────────────────────────────

function inferBoundedContexts(
  model: WorldModelType,
  entities: AdaEntity[],
  constraintsByEntity: Map<string, EntityInvariant[]>,
): BoundedContext[] {
  // Build adjacency from relations
  const entityIdToName = new Map<string, string>();
  for (const e of model.entities) entityIdToName.set(e.id, e.name);

  const adjacency = new Map<string, Set<string>>();
  for (const r of model.relations) {
    const s = entityIdToName.get(r.source);
    const t = entityIdToName.get(r.target);
    if (s && t) {
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    }
  }

  // Find connected components via union-find
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const [name, neighbors] of adjacency) {
    for (const n of neighbors) union(name, n);
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const e of entities) {
    const root = find(e.name);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(e.name);
  }

  // Create bounded contexts (only for groups with 2+ entities)
  const contexts: BoundedContext[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const invariants: EntityInvariant[] = [];
    for (const m of members) {
      invariants.push(...(constraintsByEntity.get(m) ?? []));
    }
    contexts.push({
      name: root.toLowerCase().replace(/\s+/g, "-"),
      rootEntity: root,
      entities: members,
      invariants,
    });
  }

  return contexts;
}

// ─── Blueprint → Enriched WorldModel ────────────────────────────

/**
 * Merge an Ada Blueprint back into an SWM WorldModel, producing an
 * EnrichedWorldModel that carries both descriptive structure and
 * prescriptive architecture.
 */
export function blueprintToEnrichedModel(
  base: WorldModelType,
  blueprint: Blueprint,
): EnrichedWorldModel {
  // Extract invariants per entity
  const invariants = new Map<string, EntityInvariant[]>();
  for (const entity of blueprint.dataModel.entities) {
    if (entity.invariants.length > 0) {
      invariants.set(entity.name, [...entity.invariants]);
    }
  }

  // Extract Hoare triples per workflow
  const hoareTriples = new Map<string, HoareTriple[]>();
  for (const workflow of blueprint.processModel.workflows) {
    hoareTriples.set(
      workflow.name,
      workflow.steps.map((s) => s.hoareTriple),
    );
  }

  return {
    ...base,
    boundedContexts: [...blueprint.dataModel.boundedContexts],
    invariants,
    hoareTriples,
    stateMachines: [...blueprint.processModel.stateMachines],
    nonFunctionalRequirements: [...blueprint.nonFunctional],
    stakeholders: [], // populated if persona stage ran
    buildContract: blueprint.build ?? undefined,
    governorDecision: blueprint.audit
      ? ({
          decision: blueprint.audit.governorDecision,
          confidence: blueprint.audit.confidence,
        } as GovernorDecision)
      : undefined,
    compilationAudit: blueprint.audit ?? undefined,
    postcodes: new Map(),
  };
}
