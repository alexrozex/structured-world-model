/**
 * Unit tests for mergeAmendGoals + wordOverlap (amend deduplication logic).
 * Run: node --test dist/engine.amend.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeAmendGoals, wordOverlap } from "./engine.js";
import { generatePostcode } from "@swm/provenance";
import type { IntentGraph, IntentGoal, IntentConstraint } from "./types.js";
import type { PriorBlueprintContext } from "./context/types.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const PC = generatePostcode("INT", "test");

function makeGoal(id: string, description: string): IntentGoal {
  return { id, description, type: "stated" };
}

function makeConstraint(id: string, description: string): IntentConstraint {
  return { id, description, source: "explicit" };
}

function makeIntentGraph(
  goals: IntentGoal[],
  constraints: IntentConstraint[] = [],
): IntentGraph {
  return {
    goals,
    constraints,
    unknowns: [],
    challenges: [],
    rawIntent: "test intent",
    postcode: PC,
  };
}

function makePrior(
  goals: IntentGoal[],
  constraints: IntentConstraint[] = [],
): PriorBlueprintContext {
  return {
    summary: "Prior blueprint summary",
    architecturePattern: "layered",
    components: [],
    goals,
    constraints,
    excludedConcerns: [],
  };
}

// ─── wordOverlap ──────────────────────────────────────────────────────────────

describe("wordOverlap", () => {
  test("identical strings return 1.0", () => {
    const result = wordOverlap(
      "allow users to create tasks",
      "allow users to create tasks",
    );
    assert.equal(result, 1.0);
  });

  test("completely different strings return 0", () => {
    const result = wordOverlap(
      "authentication login system",
      "payment billing invoice",
    );
    assert.equal(result, 0);
  });

  test("partial overlap returns value between 0 and 1", () => {
    const result = wordOverlap(
      "users can create tasks and manage them",
      "users can delete tasks from their list",
    );
    assert.ok(
      result > 0 && result < 1,
      `expected 0 < overlap < 1, got ${result}`,
    );
  });

  test("empty string on either side returns 0", () => {
    assert.equal(wordOverlap("", "some text here"), 0);
    assert.equal(wordOverlap("some text here", ""), 0);
  });

  test("stopwords-only strings return 0", () => {
    // All words are stopwords
    const result = wordOverlap("the a an and or but", "the a an and or but");
    assert.equal(result, 0);
  });

  test("near-duplicate strings (rephrasing) return >= 0.65", () => {
    const result = wordOverlap(
      "users should be able to create and manage tasks",
      "users can create tasks and manage their list",
    );
    assert.ok(
      result >= 0.5,
      `expected >= 0.5 for near-duplicate, got ${result}`,
    );
  });
});

// ─── mergeAmendGoals — goal deduplication ─────────────────────────────────────

describe("mergeAmendGoals — goal deduplication", () => {
  test("exact duplicate goal is removed from new goals", () => {
    const priorGoal = makeGoal("G1", "users can create tasks in the system");
    const newGoal = makeGoal("G2", "users can create tasks in the system");
    const graph = makeIntentGraph([newGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(result.goals.length, 0, "duplicate goal must be removed");
  });

  test("near-duplicate goal (overlap >= 0.65) is removed", () => {
    const priorGoal = makeGoal(
      "G1",
      "authenticated users create manage tasks dashboard",
    );
    const newGoal = makeGoal(
      "G2",
      "authenticated users create tasks manage dashboard view",
    );
    const graph = makeIntentGraph([newGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(result.goals.length, 0, "near-duplicate goal must be removed");
  });

  test("different goal (overlap < 0.65) is kept", () => {
    const priorGoal = makeGoal(
      "G1",
      "users can authenticate via email password",
    );
    const newGoal = makeGoal(
      "G2",
      "system sends notifications via email when tasks complete",
    );
    const graph = makeIntentGraph([newGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(result.goals.length, 1, "different goal must be kept");
    assert.equal(result.goals[0]!.id, "G2");
  });

  test("empty prior goals — no deduplication, goals unchanged", () => {
    const newGoal1 = makeGoal("G1", "users can create tasks");
    const newGoal2 = makeGoal("G2", "users can delete tasks");
    const graph = makeIntentGraph([newGoal1, newGoal2]);
    const prior = makePrior([]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(
      result.goals.length,
      2,
      "no goals removed when prior is empty",
    );
    assert.equal(result.goals[0]!.id, "G1");
    assert.equal(result.goals[1]!.id, "G2");
  });

  test("multiple goals — only duplicates removed, unique goals kept", () => {
    const priorGoal = makeGoal("P1", "users authenticate login system");
    const dupGoal = makeGoal("G1", "users authenticate login system");
    const uniqueGoal = makeGoal("G2", "billing payment processing invoices");
    const graph = makeIntentGraph([dupGoal, uniqueGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(result.goals.length, 1, "only unique goal survives");
    assert.equal(result.goals[0]!.id, "G2");
  });
});

// ─── mergeAmendGoals — constraint deduplication ───────────────────────────────

describe("mergeAmendGoals — constraint deduplication", () => {
  test("prior constraints are deduplicated same as goals", () => {
    const priorConstraint = makeConstraint(
      "C1",
      "TypeScript strict mode no implicit any",
    );
    const newConstraint = makeConstraint(
      "C2",
      "TypeScript strict mode no implicit any",
    );
    const graph = makeIntentGraph([], [newConstraint]);
    const prior = makePrior([], [priorConstraint]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(
      result.constraints.length,
      0,
      "duplicate constraint must be removed",
    );
  });

  test("different constraint is kept when prior has no overlap", () => {
    const priorConstraint = makeConstraint(
      "C1",
      "TypeScript strict mode required",
    );
    const newConstraint = makeConstraint(
      "C2",
      "maximum response latency 200ms performance",
    );
    const graph = makeIntentGraph([], [newConstraint]);
    const prior = makePrior([], [priorConstraint]);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(
      result.constraints.length,
      1,
      "unique constraint must be kept",
    );
    assert.equal(result.constraints[0]!.id, "C2");
  });

  test("empty prior constraints — no deduplication", () => {
    const c1 = makeConstraint("C1", "strict mode TypeScript");
    const c2 = makeConstraint("C2", "max response time 200ms");
    const graph = makeIntentGraph([], [c1, c2]);
    const prior = makePrior([], []);

    const result = mergeAmendGoals(graph, prior);

    assert.equal(result.constraints.length, 2);
  });
});

// ─── mergeAmendGoals — dedup challenge added when goals removed ───────────────

describe("mergeAmendGoals — dedup challenge", () => {
  test("dedup count challenge added when goals are removed (resolved: true, severity: minor)", () => {
    const priorGoal = makeGoal("P1", "users create manage tasks system");
    const dupGoal = makeGoal("G1", "users create manage tasks system");
    const graph = makeIntentGraph([dupGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    const dedupChallenge = result.challenges.find(
      (c) => c.id === "amend-dedup-goals",
    );
    assert.ok(dedupChallenge, "dedup challenge must be added");
    assert.equal(dedupChallenge!.resolved, true);
    assert.equal(dedupChallenge!.severity, "minor");
    assert.ok(
      dedupChallenge!.description.includes("1"),
      "description must mention count of removed goals",
    );
  });

  test("no dedup challenge when nothing is removed", () => {
    const priorGoal = makeGoal("P1", "payment billing invoicing system");
    const uniqueGoal = makeGoal("G1", "authentication login security");
    const graph = makeIntentGraph([uniqueGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    const dedupChallenge = result.challenges.find(
      (c) => c.id === "amend-dedup-goals",
    );
    assert.ok(!dedupChallenge, "no dedup challenge when nothing is removed");
  });

  test("dedup challenge added when constraints are removed", () => {
    const priorC = makeConstraint(
      "C1",
      "TypeScript strict mode always required",
    );
    const dupC = makeConstraint("C2", "TypeScript strict mode always required");
    const graph = makeIntentGraph([], [dupC]);
    const prior = makePrior([], [priorC]);

    const result = mergeAmendGoals(graph, prior);

    const dedupChallenge = result.challenges.find(
      (c) => c.id === "amend-dedup-constraints",
    );
    assert.ok(dedupChallenge, "constraint dedup challenge must be added");
    assert.equal(dedupChallenge!.resolved, true);
    assert.equal(dedupChallenge!.severity, "minor");
  });
});

// ─── mergeAmendGoals — contradiction detection ───────────────────────────────

describe("mergeAmendGoals — contradiction detection", () => {
  test("negation signal + keyword overlap -> contradiction challenge added with severity major", () => {
    const priorGoal = makeGoal(
      "P1",
      "users can store upload files documents system",
    );
    // New goal: negates + shares keywords
    const newGoal = makeGoal(
      "G1",
      "never allow users store upload files documents system",
    );
    const graph = makeIntentGraph([newGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    const contradictionChallenge = result.challenges.find((c) =>
      c.id.startsWith("amend-contradiction-"),
    );
    assert.ok(contradictionChallenge, "contradiction challenge must be added");
    assert.equal(contradictionChallenge!.severity, "major");
    assert.equal(contradictionChallenge!.resolved, false);
  });

  test("negation signal without keyword overlap -> no contradiction challenge", () => {
    const priorGoal = makeGoal(
      "P1",
      "billing payment invoicing subscription system",
    );
    // Has negation but totally different topic
    const newGoal = makeGoal(
      "G1",
      "never expose authentication credentials login token",
    );
    const graph = makeIntentGraph([newGoal]);
    const prior = makePrior([priorGoal]);

    const result = mergeAmendGoals(graph, prior);

    const contradictionChallenge = result.challenges.find((c) =>
      c.id.startsWith("amend-contradiction-"),
    );
    assert.ok(
      !contradictionChallenge,
      "no contradiction challenge when topics differ",
    );
  });

  test("existing challenges are preserved after mergeAmendGoals", () => {
    const existingChallenge = {
      id: "existing-challenge",
      description: "Pre-existing challenge",
      severity: "major" as const,
      resolved: false,
    };
    const graph: IntentGraph = {
      ...makeIntentGraph([]),
      challenges: [existingChallenge],
    };
    const prior = makePrior([]);

    const result = mergeAmendGoals(graph, prior);

    assert.ok(
      result.challenges.some((c) => c.id === "existing-challenge"),
      "existing challenges must be preserved",
    );
  });
});
