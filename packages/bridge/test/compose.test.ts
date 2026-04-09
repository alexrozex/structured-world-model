/**
 * Unit tests for packages/bridge/src/compose.ts
 *
 * Tests:
 *   - worldModelToCompilerSeed(): entity type mapping, constraint→invariant,
 *     bounded context inference
 *   - blueprintToEnrichedModel(): Blueprint fields flow into EnrichedWorldModel
 */

import {
  worldModelToCompilerSeed,
  blueprintToEnrichedModel,
} from "../src/compose.js";

import type { WorldModelType } from "@swm/core";
import type { Blueprint, EntityMap, ProcessFlow } from "@swm/compiler";
import type { PostcodeAddress } from "@swm/provenance";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function makePostcode(): PostcodeAddress {
  return {
    prefix: "ML",
    coordinate: {
      layer: "L2I",
      concern: "ENT",
      scope: "GLO",
      dimension: "WHT",
      domain: "SFT",
    },
    hash: "abc123",
    version: 1,
    raw: "ML.L2I.ENT.GLO.WHT.SFT.abc123/v1",
  };
}

function makeWorldModel(): WorldModelType {
  return {
    id: "wm_test01",
    name: "Test Model",
    description: "A model for testing bridge composition",
    version: "0.1.0",
    created_at: "2026-04-09T00:00:00.000Z",
    entities: [
      {
        id: "ent_001",
        name: "User",
        type: "actor",
        description: "A user of the system",
        properties: { email: "string", role: "admin" },
      },
      {
        id: "ent_002",
        name: "Permission",
        type: "concept",
        description: "An access permission",
      },
      {
        id: "ent_003",
        name: "LoginEvent",
        type: "event",
        description: "A login event fired on authentication",
      },
      {
        id: "ent_004",
        name: "DataCenter",
        type: "location",
        description: "Physical data center location",
      },
      {
        id: "ent_005",
        name: "AdminGroup",
        type: "group",
        description: "Group of administrators",
      },
      {
        id: "ent_006",
        name: "IsolatedEntity",
        type: "object",
        description: "An entity with no relations",
      },
    ],
    relations: [
      {
        id: "rel_001",
        source: "ent_001",
        target: "ent_002",
        type: "uses",
        label: "User uses Permission",
      },
      {
        id: "rel_002",
        source: "ent_001",
        target: "ent_003",
        type: "triggers",
        label: "User triggers LoginEvent",
      },
      {
        id: "rel_003",
        source: "ent_004",
        target: "ent_005",
        type: "contains",
        label: "DataCenter contains AdminGroup",
      },
    ],
    processes: [
      {
        id: "proc_001",
        name: "Authentication",
        description: "Authenticates the user",
        trigger: "User submits credentials",
        steps: [
          { order: 1, action: "Validate credentials", actor: "ent_001" },
          { order: 2, action: "Issue session token", actor: "ent_001" },
        ],
        outcome: "User is authenticated",
      },
    ],
    constraints: [
      {
        id: "cstr_001",
        name: "EmailRequired",
        type: "rule",
        description: "Users must have a valid email address",
        scope: ["ent_001"],
        severity: "hard",
      },
      {
        id: "cstr_002",
        name: "PermissionSoftCheck",
        type: "rule",
        description: "Permissions should be reviewed quarterly",
        scope: ["ent_002"],
        severity: "soft",
      },
    ],
    metadata: {
      source_type: "text",
      source_summary: "A test model for bridge unit tests",
      confidence: 0.9,
    },
  };
}

function makeBlueprint(): Blueprint {
  const pc = makePostcode();
  const dataModel: EntityMap = {
    entities: [
      {
        name: "User",
        category: "substance",
        properties: [{ name: "email", type: "string", required: true }],
        invariants: [
          {
            predicate: "user.email != null",
            description: "User must have email",
          },
        ],
      },
      {
        name: "Permission",
        category: "quality",
        properties: [],
        invariants: [
          {
            predicate: "permission.level >= 0",
            description: "Permission level non-negative",
          },
        ],
      },
    ],
    boundedContexts: [
      {
        name: "identity",
        rootEntity: "User",
        entities: ["User", "Permission"],
        invariants: [
          {
            predicate: "user.email != null",
            description: "User must have email",
          },
        ],
      },
    ],
    challenges: [],
    postcode: pc,
  };

  const processModel: ProcessFlow = {
    workflows: [
      {
        name: "Authentication",
        trigger: "User submits credentials",
        steps: [
          {
            name: "step-1",
            hoareTriple: {
              precondition: "User submits credentials",
              action: "Validate credentials",
              postcondition: 'Ready for "Issue session token"',
            },
            failureModes: [],
            temporalRelation: "enables",
          },
          {
            name: "step-2",
            hoareTriple: {
              precondition: 'Step "Validate credentials" completed',
              action: "Issue session token",
              postcondition: "Process outcome achieved",
            },
            failureModes: [],
            temporalRelation: "enables",
          },
        ],
      },
    ],
    stateMachines: [],
    challenges: [],
    postcode: pc,
  };

  return {
    summary: "Identity and access management blueprint",
    scope: {
      inScope: ["User management", "Authentication"],
      outOfScope: ["Billing"],
      assumptions: ["Users have internet access"],
    },
    architecture: {
      pattern: "layered",
      rationale: "Separation of concerns",
      components: [],
    },
    dataModel,
    processModel,
    nonFunctional: [
      {
        category: "security",
        requirement: "All tokens must be JWT-signed",
        scope: "identity",
        verification: "Security audit",
      },
    ],
    openQuestions: [],
    resolvedConflicts: [],
    challenges: [],
    audit: {
      coverageScore: 85,
      coherenceScore: 90,
      gatePassRate: 0.95,
      iterationCount: 2,
      governorDecision: "ACCEPT",
      confidence: 0.88,
      driftCount: 0,
      gapCount: 1,
      violationCount: 0,
    },
    postcode: pc,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function run(): void {
  console.log("═══ Bridge: compose.ts Unit Tests ═══\n");

  const model = makeWorldModel();
  const seed = worldModelToCompilerSeed(model);

  // ── worldModelToCompilerSeed: Entity type mapping ──────────────────────────

  const entities = seed.entitySeed.entities ?? [];

  const userEntity = entities.find((e) => e.name === "User");
  assert(
    userEntity?.category === "substance",
    "Entity type actor maps to Ada category substance",
  );

  const permissionEntity = entities.find((e) => e.name === "Permission");
  assert(
    permissionEntity?.category === "quality",
    "Entity type concept maps to Ada category quality",
  );

  const loginEventEntity = entities.find((e) => e.name === "LoginEvent");
  assert(
    loginEventEntity?.category === "event",
    "Entity type event maps to Ada category event",
  );

  const dataCenterEntity = entities.find((e) => e.name === "DataCenter");
  assert(
    dataCenterEntity?.category === "state",
    "Entity type location maps to Ada category state",
  );

  const adminGroupEntity = entities.find((e) => e.name === "AdminGroup");
  assert(
    adminGroupEntity?.category === "substance",
    "Entity type group maps to Ada category substance",
  );

  // ── worldModelToCompilerSeed: Entity properties ───────────────────────────

  const userProps = userEntity?.properties ?? [];
  assert(
    userProps.some((p) => p.name === "email"),
    "Entity properties are mapped (email property present on User)",
  );

  // ── worldModelToCompilerSeed: Constraint → Invariant ─────────────────────

  const userInvariants = seed.constraintsByEntity.get("User") ?? [];
  assert(
    userInvariants.length === 1,
    "Constraint scoped to User creates exactly one invariant for User",
  );

  assert(
    userInvariants[0]?.predicate.includes("EmailRequired"),
    "Constraint name appears in invariant predicate",
  );

  assert(
    userInvariants[0]?.description.includes("hard"),
    "Constraint severity appears in invariant description",
  );

  const permInvariants = seed.constraintsByEntity.get("Permission") ?? [];
  assert(
    permInvariants[0]?.description.includes("soft"),
    "Soft constraint severity appears in invariant description",
  );

  // Invariants are applied to the entities in entitySeed
  const userEntityWithInv = entities.find((e) => e.name === "User");
  assert(
    (userEntityWithInv?.invariants.length ?? 0) > 0,
    "Invariants from constraints are applied to entity in entitySeed",
  );

  // ── worldModelToCompilerSeed: Bounded Context Inference ───────────────────

  const contexts = seed.entitySeed.boundedContexts ?? [];

  // User connects to Permission and LoginEvent via relations → they form contexts
  assert(
    contexts.length >= 1,
    "Bounded contexts are inferred from entity relations",
  );

  // IsolatedEntity has no relations → should not appear as its own context
  const isolatedContext = contexts.find((c) => c.rootEntity === "IsolatedEntity");
  assert(
    isolatedContext === undefined,
    "Isolated entity (no relations) does not produce a bounded context",
  );

  // All bounded contexts have at least 2 members
  assert(
    contexts.every((c) => c.entities.length >= 2),
    "All inferred bounded contexts have 2+ member entities",
  );

  // ── worldModelToCompilerSeed: Process → Workflow ──────────────────────────

  const workflows = seed.processSeed.workflows ?? [];
  assert(
    workflows.length === 1,
    "One process maps to one workflow in processSeed",
  );

  assert(
    workflows[0]?.name === "Authentication",
    "Process name is preserved in workflow",
  );

  assert(
    workflows[0]?.steps.length === 2,
    "Process steps map to workflow steps",
  );

  assert(
    workflows[0]?.steps[0]?.hoareTriple.action === "Validate credentials",
    "First step action is preserved in Hoare triple",
  );

  assert(
    workflows[0]?.steps[0]?.hoareTriple.precondition === "User submits credentials",
    "Process trigger becomes precondition of first step",
  );

  // ── blueprintToEnrichedModel ──────────────────────────────────────────────

  const blueprint = makeBlueprint();
  const enriched = blueprintToEnrichedModel(model, blueprint);

  assert(
    enriched.id === model.id,
    "blueprintToEnrichedModel: base WorldModel id is preserved",
  );

  assert(
    enriched.boundedContexts.length === 1,
    "blueprintToEnrichedModel: boundedContexts from blueprint dataModel are present",
  );

  assert(
    enriched.boundedContexts[0]?.name === "identity",
    "blueprintToEnrichedModel: correct bounded context name is transferred",
  );

  const userInvariantsEnriched = enriched.invariants.get("User");
  assert(
    (userInvariantsEnriched?.length ?? 0) > 0,
    "blueprintToEnrichedModel: invariants from blueprint entities are mapped by name",
  );

  assert(
    userInvariantsEnriched?.[0]?.predicate === "user.email != null",
    "blueprintToEnrichedModel: invariant predicate is preserved",
  );

  const authTriples = enriched.hoareTriples.get("Authentication");
  assert(
    (authTriples?.length ?? 0) === 2,
    "blueprintToEnrichedModel: Hoare triples from workflow steps are extracted",
  );

  assert(
    authTriples?.[0]?.action === "Validate credentials",
    "blueprintToEnrichedModel: first Hoare triple action matches workflow step",
  );

  assert(
    enriched.nonFunctionalRequirements.length === 1,
    "blueprintToEnrichedModel: nonFunctional requirements are preserved",
  );

  assert(
    enriched.nonFunctionalRequirements[0]?.category === "security",
    "blueprintToEnrichedModel: NFR category is preserved",
  );

  assert(
    enriched.governorDecision !== undefined,
    "blueprintToEnrichedModel: governorDecision is set when blueprint has audit",
  );

  assert(
    enriched.governorDecision?.decision === "ACCEPT",
    "blueprintToEnrichedModel: governor decision value from audit is transferred",
  );

  assert(
    enriched.stateMachines.length === 0,
    "blueprintToEnrichedModel: stateMachines list transferred (empty in this blueprint)",
  );

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
