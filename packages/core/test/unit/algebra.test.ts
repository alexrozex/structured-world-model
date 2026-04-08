import { intersection, difference, overlay } from "../../src/utils/algebra.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(
  name: string,
  entityNames: string[],
  relations: Array<{ source: string; target: string; type: string }> = [],
  constraints: Array<{
    name: string;
    scope: string[];
    severity: "hard" | "soft";
  }> = [],
): WorldModelType {
  const entities = entityNames.map((n, i) => ({
    id: `ent_${name}_${i}`,
    name: n,
    type: "object" as const,
    description: `Entity ${n} in ${name}`,
  }));
  return {
    id: `wm_${name}`,
    name,
    description: `Model ${name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations: relations.map((r, i) => ({
      id: `rel_${name}_${i}`,
      source: entities.find((e) => e.name === r.source)?.id ?? r.source,
      target: entities.find((e) => e.name === r.target)?.id ?? r.target,
      type: r.type as WorldModelType["relations"][number]["type"],
      label: `${r.source} ${r.type} ${r.target}`,
    })),
    processes: [],
    constraints: constraints.map((c, i) => ({
      id: `cstr_${name}_${i}`,
      name: c.name,
      type: "rule" as const,
      description: c.name,
      scope: c.scope.map((s) => entities.find((e) => e.name === s)?.id ?? s),
      severity: c.severity,
    })),
    metadata: {
      source_type: "text" as const,
      source_summary: "test",
      confidence: 0.8,
    },
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
  console.log("═══ Algebra Unit Tests ═══\n");

  const frontend = makeModel(
    "Frontend",
    ["User", "UI", "API Client"],
    [
      { source: "User", target: "UI", type: "uses" },
      { source: "UI", target: "API Client", type: "uses" },
    ],
  );
  const backend = makeModel(
    "Backend",
    ["API Client", "Server", "Database"],
    [
      { source: "API Client", target: "Server", type: "uses" },
      { source: "Server", target: "Database", type: "depends_on" },
    ],
    [{ name: "Rate Limit", scope: ["Server"], severity: "hard" }],
  );

  // ─── Intersection ────────────────────────────────────

  {
    const result = intersection(frontend, backend);
    assert(
      result.entities.length === 1,
      "Intersection: 1 shared entity (API Client)",
    );
    assert(
      result.entities[0].name === "API Client",
      "Intersection: correct shared entity",
    );
  }

  {
    const a = makeModel("A", ["X", "Y"]);
    const b = makeModel("B", ["Z", "W"]);
    const result = intersection(a, b);
    assert(
      result.entities.length === 0,
      "Intersection: disjoint models = 0 entities",
    );
  }

  {
    const a = makeModel("A", ["User"]);
    const b = makeModel("B", ["user"]); // case difference
    const result = intersection(a, b);
    assert(
      result.entities.length === 1,
      "Intersection: case-insensitive match",
    );
  }

  // Shared relation
  {
    const a = makeModel(
      "A",
      ["X", "Y"],
      [{ source: "X", target: "Y", type: "uses" }],
    );
    const b = makeModel(
      "B",
      ["X", "Y"],
      [{ source: "X", target: "Y", type: "uses" }],
    );
    const result = intersection(a, b);
    assert(
      result.relations.length === 1,
      "Intersection: shared relation preserved",
    );
  }

  // ─── Difference ──────────────────────────────────────

  {
    const result = difference(frontend, backend);
    assert(
      result.entities.length === 2,
      "Difference: 2 entities unique to frontend (User, UI)",
    );
    const names = result.entities.map((e) => e.name).sort();
    assert(
      names[0] === "UI" && names[1] === "User",
      "Difference: correct unique entities",
    );
  }

  {
    const result = difference(backend, frontend);
    assert(
      result.entities.length === 2,
      "Difference (reverse): 2 unique to backend (Server, Database)",
    );
  }

  {
    const a = makeModel("A", ["X"]);
    const result = difference(a, a);
    assert(result.entities.length === 0, "Difference: A \\ A = empty");
  }

  // Relations only kept if both endpoints remain
  {
    const result = difference(frontend, backend);
    assert(
      result.relations.length === 1,
      "Difference: keeps User→UI relation (both endpoints remain)",
    );
  }

  // ─── Overlay ─────────────────────────────────────────

  {
    const base = makeModel(
      "Base",
      ["User", "Server"],
      [{ source: "User", target: "Server", type: "uses" }],
    );
    const lens = makeModel(
      "Permissions",
      ["Server", "Admin"],
      [{ source: "Admin", target: "Server", type: "controls" }],
      [{ name: "Admin Only", scope: ["Server"], severity: "hard" }],
    );

    const result = overlay(base, lens);
    assert(
      result.entities.length === 3,
      "Overlay: 3 entities (User + Server + Admin)",
    );
    assert(
      result.relations.length === 2,
      "Overlay: 2 relations (uses + controls)",
    );
    assert(result.constraints.length === 1, "Overlay: lens constraint applied");
  }

  // Overlay: lens constraint overrides base constraint with same name
  {
    const base = makeModel(
      "Base",
      ["X"],
      [],
      [{ name: "Limit", scope: ["X"], severity: "soft" }],
    );
    const lens = makeModel(
      "Lens",
      ["X"],
      [],
      [{ name: "Limit", scope: ["X"], severity: "hard" }],
    );
    const result = overlay(base, lens);
    assert(
      result.constraints.length === 1,
      "Overlay: duplicate constraint deduplicated",
    );
    assert(
      result.constraints[0].severity === "hard",
      "Overlay: lens constraint overrides base",
    );
  }

  // Overlay: empty lens is identity
  {
    const base = makeModel(
      "Base",
      ["A", "B"],
      [{ source: "A", target: "B", type: "uses" }],
    );
    const lens = makeModel("Empty", []);
    const result = overlay(base, lens);
    assert(
      result.entities.length === 2,
      "Overlay: empty lens preserves all base entities",
    );
    assert(
      result.relations.length === 1,
      "Overlay: empty lens preserves all base relations",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
