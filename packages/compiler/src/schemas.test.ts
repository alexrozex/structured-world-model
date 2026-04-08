/**
 * Unit tests for Zod schema validation in schemas.ts.
 * Run: node --test dist/schemas.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  intentGraphSchema,
  entityMapSchema,
  blueprintSchema,
  domainContextSchema,
  processFlowSchema,
  auditReportSchema,
  governorDecisionSchema,
} from "./schemas.js";

// ─── intentGraphSchema ────────────────────────────────────────────────────────

test("intentGraphSchema: valid object with goals passes", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "User can create tasks", type: "stated" }],
    constraints: [],
    unknowns: [],
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.goals.length, 1);
  assert.equal(result.data.goals[0]!.description, "User can create tasks");
});

test("intentGraphSchema: missing goals field is rejected", () => {
  const result = intentGraphSchema.safeParse({
    constraints: [],
    unknowns: [],
  });
  assert.ok(!result.success, "expected failure for missing goals");
});

test("intentGraphSchema: constraints and unknowns default to [] when absent", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "Sign up", type: "stated" }],
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.constraints, []);
  assert.deepEqual(result.data!.unknowns, []);
});

test("intentGraphSchema: goal with unknown type is coerced to 'derived'", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "Some goal", type: "made_up_type" }],
  });
  assert.ok(result.success);
  assert.equal(result.data!.goals[0]!.type, "derived");
});

test("intentGraphSchema: challenge as string is coerced to object", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "Goal", type: "stated" }],
    challenges: ["This is a problem"],
  });
  assert.ok(result.success);
  assert.equal(result.data!.challenges[0]!.description, "This is a problem");
  assert.equal(result.data!.challenges[0]!.severity, "minor");
});

test("intentGraphSchema: rawIntent defaults to empty string when absent", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "Goal", type: "stated" }],
  });
  assert.ok(result.success);
  assert.equal(result.data!.rawIntent, "");
});

test("intentGraphSchema: constraint source unknown type coerced to 'derived'", () => {
  const result = intentGraphSchema.safeParse({
    goals: [{ id: "G1", description: "Goal", type: "stated" }],
    constraints: [
      { id: "C1", description: "Max 100 users", source: "unknown_source" },
    ],
  });
  assert.ok(result.success);
  assert.equal(result.data!.constraints[0]!.source, "derived");
});

// ─── entityMapSchema ──────────────────────────────────────────────────────────

test("entityMapSchema: valid entity passes", () => {
  const result = entityMapSchema.safeParse({
    entities: [
      {
        name: "Task",
        category: "substance",
        properties: [{ name: "id", type: "string", required: true }],
        invariants: [],
      },
    ],
    boundedContexts: [],
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.entities[0]!.name, "Task");
});

test("entityMapSchema: missing entities field is rejected", () => {
  const result = entityMapSchema.safeParse({
    boundedContexts: [],
  });
  assert.ok(!result.success, "expected failure for missing entities");
});

test("entityMapSchema: entity category unknown type coerced to 'substance'", () => {
  const result = entityMapSchema.safeParse({
    entities: [{ name: "Thing", category: "weird_type" }],
  });
  assert.ok(result.success);
  assert.equal(result.data!.entities[0]!.category, "substance");
});

test("entityMapSchema: entity invariant as string is coerced to {predicate, description}", () => {
  const result = entityMapSchema.safeParse({
    entities: [
      {
        name: "Task",
        category: "substance",
        invariants: ["task.title must not be empty"],
      },
    ],
  });
  assert.ok(result.success);
  const inv = result.data!.entities[0]!.invariants[0]!;
  assert.equal(inv.predicate, "task.title must not be empty");
  assert.equal(inv.description, "task.title must not be empty");
});

test("entityMapSchema: boundedContexts defaults to [] when absent", () => {
  const result = entityMapSchema.safeParse({
    entities: [],
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.boundedContexts, []);
});

test("entityMapSchema: entity properties default to [] when absent", () => {
  const result = entityMapSchema.safeParse({
    entities: [{ name: "Task", category: "substance" }],
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.entities[0]!.properties, []);
});

// ─── blueprintSchema ──────────────────────────────────────────────────────────

test("blueprintSchema: valid minimal blueprint passes", () => {
  const result = blueprintSchema.safeParse({
    summary: "A task management app.",
    architecture: {
      pattern: "layered",
      rationale: "Simple CRUD.",
      components: [
        {
          name: "TaskStore",
          responsibility: "Persists tasks.",
          boundedContext: "Tasks",
        },
      ],
    },
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.summary, "A task management app.");
  assert.equal(result.data.architecture.pattern, "layered");
  assert.equal(result.data.architecture.components.length, 1);
});

test("blueprintSchema: missing summary is rejected", () => {
  const result = blueprintSchema.safeParse({
    architecture: {
      pattern: "layered",
      rationale: "Simple.",
      components: [],
    },
  });
  assert.ok(!result.success, "expected failure for missing summary");
});

test("blueprintSchema: missing architecture is rejected", () => {
  const result = blueprintSchema.safeParse({
    summary: "Some app.",
  });
  assert.ok(!result.success, "expected failure for missing architecture");
});

test("blueprintSchema: openQuestions defaults to [] when absent", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.openQuestions, []);
});

test("blueprintSchema: nonFunctional defaults to [] when absent", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.nonFunctional, []);
});

test("blueprintSchema: nonFunctional as string is coerced to object", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
    nonFunctional: ["TypeScript strict mode"],
  });
  assert.ok(result.success);
  assert.equal(
    result.data!.nonFunctional[0]!.requirement,
    "TypeScript strict mode",
  );
  assert.equal(result.data!.nonFunctional[0]!.category, "maintainability");
});

test("blueprintSchema: scope defaults to empty arrays when absent", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.scope.inScope, []);
  assert.deepEqual(result.data!.scope.outOfScope, []);
});

test("blueprintSchema: resolvedConflict as string is coerced to object", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
    resolvedConflicts: ["Entity wins over process for User"],
  });
  assert.ok(result.success);
  const conflict = result.data!.resolvedConflicts[0]!;
  assert.equal(conflict.entity, "Entity wins over process for User");
});

test("blueprintSchema: openQuestions accept string items", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: { pattern: "layered", rationale: "Simple.", components: [] },
    openQuestions: ["Should we support SSO?", "What's the storage limit?"],
  });
  assert.ok(result.success);
  assert.equal(result.data!.openQuestions.length, 2);
  assert.equal(result.data!.openQuestions[0], "Should we support SSO?");
});

test("blueprintSchema: component dependencies default to [] when absent", () => {
  const result = blueprintSchema.safeParse({
    summary: "App.",
    architecture: {
      pattern: "layered",
      rationale: "Simple.",
      components: [
        {
          name: "Service",
          responsibility: "Does things.",
          boundedContext: "Core",
        },
      ],
    },
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.architecture.components[0]!.dependencies, []);
});

// ─── domainContextSchema ──────────────────────────────────────────────────────

test("domainContextSchema: valid minimal object passes", () => {
  const result = domainContextSchema.safeParse({ domain: "productivity" });
  assert.ok(result.success);
  assert.equal(result.data.domain, "productivity");
});

test("domainContextSchema: missing domain is rejected", () => {
  const result = domainContextSchema.safeParse({ stakeholders: [] });
  assert.ok(!result.success, "expected failure for missing domain");
});

test("domainContextSchema: excludedConcerns defaults to []", () => {
  const result = domainContextSchema.safeParse({ domain: "health" });
  assert.ok(result.success);
  assert.deepEqual(result.data!.excludedConcerns, []);
});

// ─── processFlowSchema ────────────────────────────────────────────────────────

test("processFlowSchema: valid minimal object passes", () => {
  const result = processFlowSchema.safeParse({
    workflows: [
      {
        name: "create-task",
        trigger: "user submits form",
        steps: [
          {
            name: "validate-input",
            hoareTriple: {
              precondition: "form is submitted",
              action: "validate all fields",
              postcondition: "form is valid",
            },
            temporalRelation: "enables",
          },
        ],
      },
    ],
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.workflows[0]!.name, "create-task");
});

test("processFlowSchema: missing workflows is rejected", () => {
  const result = processFlowSchema.safeParse({ stateMachines: [] });
  assert.ok(!result.success, "expected failure for missing workflows");
});

test("processFlowSchema: stateMachines defaults to []", () => {
  const result = processFlowSchema.safeParse({ workflows: [] });
  assert.ok(result.success);
  assert.deepEqual(result.data!.stateMachines, []);
});

test("processFlowSchema: workflow step temporalRelation unknown type coerced to 'enables'", () => {
  const result = processFlowSchema.safeParse({
    workflows: [
      {
        name: "wf",
        trigger: "event",
        steps: [
          {
            name: "step-1",
            hoareTriple: { precondition: "P", action: "A", postcondition: "Q" },
            temporalRelation: "weird_relation",
          },
        ],
      },
    ],
  });
  assert.ok(result.success);
  assert.equal(
    result.data!.workflows[0]!.steps[0]!.temporalRelation,
    "enables",
  );
});

// ─── auditReportSchema ────────────────────────────────────────────────────────

test("auditReportSchema: valid object passes", () => {
  const result = auditReportSchema.safeParse({
    coverageScore: 0.85,
    coherenceScore: 0.9,
    passed: true,
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.coverageScore, 0.85);
  assert.equal(result.data.passed, true);
});

test("auditReportSchema: missing coverageScore is rejected", () => {
  const result = auditReportSchema.safeParse({
    coherenceScore: 0.9,
    passed: true,
  });
  assert.ok(!result.success, "expected failure for missing coverageScore");
});

test("auditReportSchema: coverageScore out of range [0,1] is rejected", () => {
  const result = auditReportSchema.safeParse({
    coverageScore: 1.5,
    coherenceScore: 0.9,
    passed: true,
  });
  assert.ok(!result.success, "expected failure for coverageScore > 1");
});

test("auditReportSchema: drift as string is coerced to object", () => {
  const result = auditReportSchema.safeParse({
    coverageScore: 0.7,
    coherenceScore: 0.8,
    passed: false,
    drifts: ["TaskStore was renamed to TaskRepository"],
  });
  assert.ok(result.success);
  assert.equal(
    result.data!.drifts[0]!.original,
    "TaskStore was renamed to TaskRepository",
  );
});

// ─── governorDecisionSchema ───────────────────────────────────────────────────

test("governorDecisionSchema: valid ACCEPT decision passes", () => {
  const result = governorDecisionSchema.safeParse({
    decision: "ACCEPT",
    confidence: 0.95,
    coverageScore: 0.9,
    coherenceScore: 0.88,
    gatePassRate: 1.0,
    provenanceIntact: true,
  });
  assert.ok(
    result.success,
    `expected success, got: ${!result.success && result.error}`,
  );
  assert.equal(result.data.decision, "ACCEPT");
});

test("governorDecisionSchema: missing confidence is rejected", () => {
  const result = governorDecisionSchema.safeParse({
    decision: "ACCEPT",
    coverageScore: 0.9,
    coherenceScore: 0.88,
    gatePassRate: 1.0,
    provenanceIntact: true,
  });
  assert.ok(!result.success, "expected failure for missing confidence");
});

test("governorDecisionSchema: unknown decision coerced to 'ITERATE'", () => {
  const result = governorDecisionSchema.safeParse({
    decision: "UNKNOWN_DECISION",
    confidence: 0.5,
    coverageScore: 0.5,
    coherenceScore: 0.5,
    gatePassRate: 0.5,
    provenanceIntact: false,
  });
  assert.ok(result.success);
  assert.equal(result.data!.decision, "ITERATE");
});

test("governorDecisionSchema: rejectionReasons defaults to [] when absent", () => {
  const result = governorDecisionSchema.safeParse({
    decision: "REJECT",
    confidence: 0.2,
    coverageScore: 0.3,
    coherenceScore: 0.4,
    gatePassRate: 0.5,
    provenanceIntact: false,
  });
  assert.ok(result.success);
  assert.deepEqual(result.data!.rejectionReasons, []);
});
