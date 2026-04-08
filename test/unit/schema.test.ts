import {
  WorldModel,
  Entity,
  Relation,
  Process,
  Constraint,
  ValidationResult,
} from "../../src/schema/world-model.js";
import { genId } from "../../src/utils/ids.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function run() {
  console.log("═══ Schema & IDs Unit Tests ═══\n");

  // ─── genId ───────────────────────────────────────────

  {
    const id = genId("ent");
    assert(id.startsWith("ent_"), "genId: correct prefix");
    assert(
      id.length === 3 + 1 + 12,
      "genId: correct length (prefix + _ + 12 hex)",
    );
  }

  {
    const ids = new Set(Array.from({ length: 1000 }, () => genId("test")));
    assert(ids.size === 1000, "genId: 1000 IDs are unique");
  }

  {
    assert(genId("rel").startsWith("rel_"), "genId: rel prefix");
    assert(genId("proc").startsWith("proc_"), "genId: proc prefix");
    assert(genId("cstr").startsWith("cstr_"), "genId: cstr prefix");
    assert(genId("wm").startsWith("wm_"), "genId: wm prefix");
  }

  // ─── Entity schema ──────────────────────────────────

  {
    const valid = Entity.safeParse({
      id: "ent_1",
      name: "User",
      type: "actor",
      description: "A user",
    });
    assert(valid.success, "Entity: valid minimal entity passes");
  }

  {
    const withAll = Entity.safeParse({
      id: "ent_1",
      name: "User",
      type: "actor",
      description: "A user",
      properties: { age: 30 },
      tags: ["admin"],
      confidence: 0.9,
    });
    assert(
      withAll.success,
      "Entity: full entity with properties/tags/confidence passes",
    );
  }

  {
    const badType = Entity.safeParse({
      id: "ent_1",
      name: "User",
      type: "invalid_type",
      description: "A user",
    });
    assert(!badType.success, "Entity: invalid type rejected");
  }

  {
    const missingName = Entity.safeParse({
      id: "ent_1",
      type: "actor",
      description: "A user",
    });
    assert(!missingName.success, "Entity: missing name rejected");
  }

  // ─── Relation schema ────────────────────────────────

  {
    const valid = Relation.safeParse({
      id: "rel_1",
      type: "uses",
      source: "ent_1",
      target: "ent_2",
      label: "queries",
    });
    assert(valid.success, "Relation: valid relation passes");
  }

  {
    const badType = Relation.safeParse({
      id: "rel_1",
      type: "bad_type",
      source: "ent_1",
      target: "ent_2",
      label: "x",
    });
    assert(!badType.success, "Relation: invalid type rejected");
  }

  {
    const withWeight = Relation.safeParse({
      id: "rel_1",
      type: "uses",
      source: "ent_1",
      target: "ent_2",
      label: "x",
      weight: 0.8,
      bidirectional: true,
    });
    assert(withWeight.success, "Relation: weight and bidirectional accepted");
  }

  // ─── Process schema ─────────────────────────────────

  {
    const valid = Process.safeParse({
      id: "proc_1",
      name: "Login",
      description: "Login flow",
      steps: [{ order: 1, action: "auth" }],
      participants: ["ent_1"],
      outcomes: ["session"],
    });
    assert(valid.success, "Process: valid process passes");
  }

  {
    const noSteps = Process.safeParse({
      id: "proc_1",
      name: "Empty",
      description: "No steps",
      steps: [],
      participants: [],
      outcomes: [],
    });
    assert(
      noSteps.success,
      "Process: empty steps array is valid (validation catches it)",
    );
  }

  // ─── Constraint schema ──────────────────────────────

  {
    const valid = Constraint.safeParse({
      id: "cstr_1",
      name: "Limit",
      type: "capacity",
      description: "Max 100",
      scope: ["ent_1"],
      severity: "hard",
    });
    assert(valid.success, "Constraint: valid constraint passes");
  }

  {
    const badSeverity = Constraint.safeParse({
      id: "cstr_1",
      name: "Limit",
      type: "capacity",
      description: "Max 100",
      scope: [],
      severity: "extreme",
    });
    assert(!badSeverity.success, "Constraint: invalid severity rejected");
  }

  // ─── WorldModel schema ──────────────────────────────

  {
    const valid = WorldModel.safeParse({
      id: "wm_1",
      name: "Test",
      description: "Test model",
      version: "0.1.0",
      created_at: "2024-01-01T00:00:00Z",
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    assert(valid.success, "WorldModel: empty model is valid");
  }

  {
    const missing = WorldModel.safeParse({ id: "wm_1" });
    assert(!missing.success, "WorldModel: missing required fields rejected");
  }

  // ─── ValidationResult schema ────────────────────────

  {
    const valid = ValidationResult.safeParse({
      valid: true,
      issues: [],
      stats: { entities: 5, relations: 3, processes: 1, constraints: 2 },
    });
    assert(valid.success, "ValidationResult: valid result passes");
  }

  // ─── Confidence bounds ──────────────────────────────

  {
    const overOne = Entity.safeParse({
      id: "ent_1",
      name: "X",
      type: "object",
      description: "x",
      confidence: 1.5,
    });
    assert(!overOne.success, "Entity confidence: >1 rejected");
  }

  {
    const negative = Entity.safeParse({
      id: "ent_1",
      name: "X",
      type: "object",
      description: "x",
      confidence: -0.1,
    });
    assert(!negative.success, "Entity confidence: <0 rejected");
  }

  {
    const zero = Entity.safeParse({
      id: "ent_1",
      name: "X",
      type: "object",
      description: "x",
      confidence: 0,
    });
    assert(zero.success, "Entity confidence: 0 accepted");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
