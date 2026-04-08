/**
 * Unit tests for evaluateInvariants — pure function, no I/O.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateInvariants } from "./drift.js";
import { generatePostcode } from "@swm/provenance";
import type { Blueprint } from "@swm/compiler";

// ─── Minimal blueprint fixture ────────────────────────────────────────────────

function makeBlueprint(
  invariants: { predicate: string; description: string }[],
): Blueprint {
  const pc = generatePostcode("SYN", "test");
  return {
    summary: "test",
    scope: { inScope: [], outOfScope: [], assumptions: [] },
    architecture: { pattern: "layered", rationale: "test", components: [] },
    dataModel: {
      entities: [
        {
          name: "User",
          category: "substance",
          properties: [],
          invariants: invariants.map((inv, i) => ({
            id: `inv-${i}`,
            predicate: inv.predicate,
            description: inv.description,
            enforcement: "hook" as const,
          })),
        },
      ],
      boundedContexts: [],
      challenges: [],
      postcode: generatePostcode("ENT", "test"),
    },
    processModel: {
      workflows: [],
      stateMachines: [],
      challenges: [],
      postcode: generatePostcode("PRO", "test"),
    },
    nonFunctional: [],
    openQuestions: [],
    resolvedConflicts: [],
    challenges: [],
    postcode: pc,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("no drift when output is clean", () => {
  const bp = makeBlueprint([
    { predicate: "User.email !== null", description: "email required" },
  ]);
  const drifts = evaluateInvariants(bp, '{"id": "u1", "email": "a@b.com"}');
  assert.equal(drifts.length, 0);
});

test("detects !== null violation when field is null", () => {
  const bp = makeBlueprint([
    { predicate: "User.email !== null", description: "email required" },
  ]);
  const drifts = evaluateInvariants(bp, '{"id": "u1", "email": null}');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0]!.hasDrift, true);
  assert.equal(drifts[0]!.severity, "major");
  assert.ok(drifts[0]!.location.includes("User"));
});

test("detects != null variant", () => {
  const bp = makeBlueprint([
    { predicate: "User.name != null", description: "name required" },
  ]);
  const drifts = evaluateInvariants(bp, '{"name": null}');
  assert.equal(drifts.length, 1);
});

test("detects > 0 violation when field is 0", () => {
  const bp = makeBlueprint([
    { predicate: "User.age > 0", description: "age must be positive" },
  ]);
  const drifts = evaluateInvariants(bp, '{"age": 0}');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0]!.hasDrift, true);
});

test("detects > 0 violation when field is negative", () => {
  const bp = makeBlueprint([
    { predicate: "User.count > 0", description: "count must be positive" },
  ]);
  const drifts = evaluateInvariants(bp, '{"count": -1}');
  assert.equal(drifts.length, 1);
});

test("no drift for > 0 when field is positive", () => {
  const bp = makeBlueprint([
    { predicate: "User.age > 0", description: "age must be positive" },
  ]);
  const drifts = evaluateInvariants(bp, '{"age": 25}');
  assert.equal(drifts.length, 0);
});

test("multiple invariants — multiple violations detected", () => {
  const bp = makeBlueprint([
    { predicate: "User.email !== null", description: "email required" },
    { predicate: "User.count > 0", description: "count positive" },
  ]);
  const drifts = evaluateInvariants(bp, '{"email": null, "count": 0}');
  assert.equal(drifts.length, 2);
});

test("no entities — no drift", () => {
  const pc = generatePostcode("SYN", "test");
  const bp: Blueprint = {
    summary: "test",
    scope: { inScope: [], outOfScope: [], assumptions: [] },
    architecture: { pattern: "layered", rationale: "test", components: [] },
    dataModel: {
      entities: [],
      boundedContexts: [],
      challenges: [],
      postcode: generatePostcode("ENT", "test"),
    },
    processModel: {
      workflows: [],
      stateMachines: [],
      challenges: [],
      postcode: generatePostcode("PRO", "test"),
    },
    nonFunctional: [],
    openQuestions: [],
    resolvedConflicts: [],
    challenges: [],
    postcode: pc,
  };
  const drifts = evaluateInvariants(bp, '{"email": null}');
  assert.equal(drifts.length, 0);
});

test("drift result has location identifying entity and predicate", () => {
  const bp = makeBlueprint([
    { predicate: "User.id !== null", description: "id required" },
  ]);
  const drifts = evaluateInvariants(bp, '{"id": null}');
  assert.equal(drifts.length, 1);
  assert.ok(
    drifts[0]!.location.includes("User"),
    "location should mention entity",
  );
  assert.ok(drifts[0]!.detail.length > 0, "detail should be non-empty");
});
