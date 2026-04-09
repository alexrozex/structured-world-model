import { coverage } from "../../src/utils/coverage.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(
  name: string,
  entityNames: string[],
  relations: Array<{ source: string; target: string; type: string }> = [],
  processes: string[] = [],
  constraints: string[] = [],
): WorldModelType {
  const entities = entityNames.map((n, i) => ({
    id: `ent_${name}_${i}`,
    name: n,
    type: "object" as const,
    description: n,
  }));
  return {
    id: `wm_${name}`,
    name,
    description: name,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations: relations.map((r, i) => ({
      id: `rel_${name}_${i}`,
      source: entities.find((e) => e.name === r.source)?.id ?? r.source,
      target: entities.find((e) => e.name === r.target)?.id ?? r.target,
      type: r.type as WorldModelType["relations"][number]["type"],
      label: "",
    })),
    processes: processes.map((p, i) => ({
      id: `proc_${name}_${i}`,
      name: p,
      description: p,
      steps: [{ order: 1, action: "do" }],
      participants: [],
      outcomes: [],
    })),
    constraints: constraints.map((c, i) => ({
      id: `cstr_${name}_${i}`,
      name: c,
      type: "rule" as const,
      description: c,
      scope: [],
      severity: "hard" as const,
    })),
  };
}

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
  console.log("═══ Coverage Unit Tests ═══\n");

  // Identical models = 100%
  {
    const a = makeModel(
      "A",
      ["User", "DB"],
      [{ source: "User", target: "DB", type: "uses" }],
      ["Login"],
      ["Rate Limit"],
    );
    const r = coverage(a, a);
    assert(r.overall === 1, "Identical: 100% overall");
    assert(r.entityCoverage === 1, "Identical: 100% entities");
    assert(r.missingEntities.length === 0, "Identical: no missing");
  }

  // B has everything in A plus more
  {
    const a = makeModel("Spec", ["User", "DB"]);
    const b = makeModel("Code", ["User", "DB", "Cache"]);
    const r = coverage(a, b);
    assert(r.entityCoverage === 1, "Superset: 100% entity coverage");
    assert(r.extraEntities.length === 1, "Superset: 1 extra entity");
    assert(r.extraEntities[0] === "Cache", "Superset: Cache is extra");
  }

  // B is missing half of A
  {
    const a = makeModel("Spec", ["User", "DB", "Cache", "Queue"]);
    const b = makeModel("Code", ["User", "DB"]);
    const r = coverage(a, b);
    assert(r.entityCoverage === 0.5, "Half: 50% entity coverage");
    assert(r.missingEntities.length === 2, "Half: 2 missing entities");
  }

  // Case-insensitive matching
  {
    const a = makeModel("A", ["User"]);
    const b = makeModel("B", ["user"]);
    const r = coverage(a, b);
    assert(r.entityCoverage === 1, "Case: case-insensitive match");
  }

  // Empty reference = 100% (nothing to cover)
  {
    const a = makeModel("Empty", []);
    const b = makeModel("Full", ["User", "DB"]);
    const r = coverage(a, b);
    assert(r.overall === 1, "Empty ref: 100% overall");
  }

  // Empty target = 0% (nothing covers)
  {
    const a = makeModel("Spec", ["User", "DB"]);
    const b = makeModel("Empty", []);
    const r = coverage(a, b);
    assert(r.entityCoverage === 0, "Empty target: 0% entities");
    assert(r.missingEntities.length === 2, "Empty target: all missing");
  }

  // Relation coverage
  {
    const a = makeModel(
      "A",
      ["User", "DB"],
      [{ source: "User", target: "DB", type: "uses" }],
    );
    const b = makeModel(
      "B",
      ["User", "DB"],
      [{ source: "User", target: "DB", type: "uses" }],
    );
    const r = coverage(a, b);
    assert(r.relationCoverage === 1, "Relations: matching relation = 100%");
  }

  {
    const a = makeModel(
      "A",
      ["User", "DB"],
      [{ source: "User", target: "DB", type: "uses" }],
    );
    const b = makeModel("B", ["User", "DB"], []);
    const r = coverage(a, b);
    assert(r.relationCoverage === 0, "Relations: missing relation = 0%");
    assert(r.missingRelations.length === 1, "Relations: 1 missing");
  }

  // Process + constraint coverage
  {
    const a = makeModel(
      "A",
      [],
      [],
      ["Login", "Signup"],
      ["Rate Limit", "Auth"],
    );
    const b = makeModel("B", [], [], ["Login"], ["Rate Limit"]);
    const r = coverage(a, b);
    assert(r.processCoverage === 0.5, "Processes: 50% coverage");
    assert(r.constraintCoverage === 0.5, "Constraints: 50% coverage");
    assert(r.missingProcesses.length === 1, "Processes: 1 missing");
    assert(r.missingConstraints.length === 1, "Constraints: 1 missing");
  }

  // ─── Fuzzy matching tests ──────────────────────────────────

  // Fuzzy: similar entity names should match
  {
    const spec = makeModel("spec", [
      "User Authentication System",
      "Password Reset Token",
    ]);
    const impl = makeModel("impl", [
      "Authentication System",
      "Password Reset Feature",
    ]);
    const r = coverage(spec, impl);
    assert(
      r.entityCoverage > 0.5,
      `Fuzzy entities: coverage ${r.entityCoverage} > 0.5 (similar names match)`,
    );
    assert(
      r.missingEntities.length < 2,
      "Fuzzy entities: fewer missing than exact match would give",
    );
  }

  // Fuzzy: completely different names should NOT match
  {
    const spec = makeModel("spec", ["Payment Gateway", "Invoice Generator"]);
    const impl = makeModel("impl", ["User Profile", "Dashboard Widget"]);
    const r = coverage(spec, impl);
    assert(
      r.entityCoverage === 0,
      "No fuzzy match for completely different names",
    );
    assert(r.missingEntities.length === 2, "Both entities missing");
  }

  // Fuzzy: process names
  {
    const spec = makeModel("spec", ["User"], [], ["User Registration Flow"]);
    const impl = makeModel("impl", ["User"], [], ["User Registration Process"]);
    const r = coverage(spec, impl);
    assert(
      r.processCoverage > 0,
      "Fuzzy process: 'User Registration Flow' ≈ 'User Registration Process'",
    );
  }

  // Fuzzy: constraint names
  {
    const spec = makeModel(
      "spec",
      ["User"],
      [],
      [],
      ["Password Complexity Rule"],
    );
    const impl = makeModel(
      "impl",
      ["User"],
      [],
      [],
      ["Password Complexity Requirement"],
    );
    const r = coverage(spec, impl);
    assert(
      r.constraintCoverage > 0,
      "Fuzzy constraint: 'Rule' ≈ 'Requirement' with shared words",
    );
  }

  // Fuzzy: exact match still takes priority
  {
    const spec = makeModel("spec", ["User", "Admin"]);
    const impl = makeModel("impl", ["User", "Admin"]);
    const r = coverage(spec, impl);
    assert(r.entityCoverage === 1, "Exact match: 100% coverage");
    assert(r.missingEntities.length === 0, "Exact match: zero missing");
    assert(r.extraEntities.length === 0, "Exact match: zero extra");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
