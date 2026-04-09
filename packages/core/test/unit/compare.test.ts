import { compare } from "../../src/utils/compare.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(
  name: string,
  entities: Array<{ name: string; type: string; description: string }>,
  relations: Array<{ source: string; target: string; type: string }> = [],
  constraints: Array<{
    name: string;
    severity: "hard" | "soft";
    scope?: string[];
  }> = [],
  processes: Array<{
    name: string;
    trigger?: string;
    steps: Array<{ order: number; action: string }>;
  }> = [],
): WorldModelType {
  const ents = entities.map((e, i) => ({
    id: `ent_${name}_${i}`,
    name: e.name,
    type: e.type as WorldModelType["entities"][number]["type"],
    description: e.description,
  }));
  return {
    id: `wm_${name}`,
    name,
    description: name,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: ents,
    relations: relations.map((r, i) => ({
      id: `rel_${name}_${i}`,
      source: ents.find((e) => e.name === r.source)?.id ?? r.source,
      target: ents.find((e) => e.name === r.target)?.id ?? r.target,
      type: r.type as WorldModelType["relations"][number]["type"],
      label: "",
    })),
    processes: processes.map((p, i) => ({
      id: `proc_${name}_${i}`,
      name: p.name,
      description: p.name,
      trigger: p.trigger,
      steps: p.steps,
      participants: [],
      outcomes: [],
    })),
    constraints: constraints.map((c, i) => ({
      id: `cstr_${name}_${i}`,
      name: c.name,
      type: "rule" as const,
      description: c.name,
      scope: c.scope
        ? c.scope.map((s) => ents.find((e) => e.name === s)?.id ?? s)
        : [],
      severity: c.severity,
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
  console.log("═══ Compare Unit Tests ═══\n");

  // Identical models — no conflicts
  {
    const m = makeModel("A", [
      { name: "User", type: "actor", description: "user" },
    ]);
    const r = compare(m, m);
    assert(r.conflicts.length === 0, "Identical: no conflicts");
    assert(r.agreements === 1, "Identical: 1 agreement");
    assert(r.conflictRate === 0, "Identical: 0% conflict rate");
  }

  // Entity type conflict
  {
    const a = makeModel("A", [
      { name: "User", type: "actor", description: "user" },
    ]);
    const b = makeModel("B", [
      { name: "User", type: "system", description: "user" },
    ]);
    const r = compare(a, b);
    assert(r.conflicts.length === 1, "Entity type: 1 conflict");
    assert(r.conflicts[0].kind === "entity_type", "Entity type: correct kind");
    assert(r.conflicts[0].modelA === "actor", "Entity type: A is actor");
    assert(r.conflicts[0].modelB === "system", "Entity type: B is system");
  }

  // Relation type conflict
  {
    const a = makeModel(
      "A",
      [
        { name: "X", type: "object", description: "x" },
        { name: "Y", type: "object", description: "y" },
      ],
      [{ source: "X", target: "Y", type: "uses" }],
    );
    const b = makeModel(
      "B",
      [
        { name: "X", type: "object", description: "x" },
        { name: "Y", type: "object", description: "y" },
      ],
      [{ source: "X", target: "Y", type: "depends_on" }],
    );
    const r = compare(a, b);
    assert(
      r.conflicts.some((c) => c.kind === "relation_type"),
      "Relation type: conflict detected",
    );
    assert(
      r.conflicts.find((c) => c.kind === "relation_type")?.modelA === "uses",
      "Relation type: A is uses",
    );
  }

  // Constraint severity conflict
  {
    const a = makeModel("A", [], [], [{ name: "Limit", severity: "soft" }]);
    const b = makeModel("B", [], [], [{ name: "Limit", severity: "hard" }]);
    const r = compare(a, b);
    assert(
      r.conflicts.some((c) => c.kind === "constraint_severity"),
      "Constraint severity: conflict detected",
    );
  }

  // Disjoint models — no conflicts (nothing to compare)
  {
    const a = makeModel("A", [{ name: "X", type: "object", description: "x" }]);
    const b = makeModel("B", [{ name: "Y", type: "object", description: "y" }]);
    const r = compare(a, b);
    assert(r.conflicts.length === 0, "Disjoint: no conflicts");
    assert(r.agreements === 0, "Disjoint: no agreements");
  }

  // Case-insensitive matching
  {
    const a = makeModel("A", [
      { name: "User", type: "actor", description: "user" },
    ]);
    const b = makeModel("B", [
      { name: "user", type: "system", description: "user" },
    ]);
    const r = compare(a, b);
    assert(
      r.conflicts.length === 1,
      "Case: case-insensitive conflict detection",
    );
  }

  // Mixed agreements and conflicts
  {
    const a = makeModel("A", [
      { name: "User", type: "actor", description: "user" },
      { name: "DB", type: "system", description: "database" },
    ]);
    const b = makeModel("B", [
      { name: "User", type: "actor", description: "user" },
      { name: "DB", type: "object", description: "database" },
    ]);
    const r = compare(a, b);
    assert(r.agreements === 1, "Mixed: 1 agreement (User)");
    assert(r.conflicts.length === 1, "Mixed: 1 conflict (DB)");
    assert(r.conflictRate === 0.5, "Mixed: 50% conflict rate");
  }

  // Process: same name, different step count → conflict
  {
    const a = makeModel(
      "A",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          trigger: "push",
          steps: [
            { order: 1, action: "build" },
            { order: 2, action: "test" },
          ],
        },
      ],
    );
    const b = makeModel(
      "B",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          trigger: "push",
          steps: [
            { order: 1, action: "build" },
            { order: 2, action: "test" },
            { order: 3, action: "release" },
          ],
        },
      ],
    );
    const r = compare(a, b);
    assert(
      r.conflicts.some((c) => c.kind === "process_mismatch"),
      "Process step count: conflict detected",
    );
    assert(
      r.conflicts.some(
        (c) =>
          c.kind === "process_mismatch" &&
          c.modelA === "2 steps" &&
          c.modelB === "3 steps",
      ),
      "Process step count: correct values",
    );
  }

  // Process: same name, same step count, different actions → conflict
  {
    const a = makeModel(
      "A",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          steps: [
            { order: 1, action: "build" },
            { order: 2, action: "test" },
          ],
        },
      ],
    );
    const b = makeModel(
      "B",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          steps: [
            { order: 1, action: "build" },
            { order: 2, action: "lint" },
          ],
        },
      ],
    );
    const r = compare(a, b);
    assert(
      r.conflicts.some(
        (c) =>
          c.kind === "process_mismatch" &&
          c.element === "Deploy step 2" &&
          c.modelA === "test" &&
          c.modelB === "lint",
      ),
      "Process step action: conflict detected with correct details",
    );
  }

  // Process: same name, different trigger → conflict
  {
    const a = makeModel(
      "A",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          trigger: "push",
          steps: [{ order: 1, action: "build" }],
        },
      ],
    );
    const b = makeModel(
      "B",
      [],
      [],
      [],
      [
        {
          name: "Deploy",
          trigger: "manual",
          steps: [{ order: 1, action: "build" }],
        },
      ],
    );
    const r = compare(a, b);
    assert(
      r.conflicts.some(
        (c) =>
          c.kind === "process_mismatch" &&
          c.element === "Deploy trigger" &&
          c.modelA === "push" &&
          c.modelB === "manual",
      ),
      "Process trigger: conflict detected",
    );
  }

  // Constraint: same name, different severity → conflict
  {
    const a = makeModel("A", [], [], [{ name: "MaxSize", severity: "soft" }]);
    const b = makeModel("B", [], [], [{ name: "MaxSize", severity: "hard" }]);
    const r = compare(a, b);
    assert(
      r.conflicts.some(
        (c) =>
          c.kind === "constraint_severity" &&
          c.element === "MaxSize" &&
          c.modelA === "soft" &&
          c.modelB === "hard",
      ),
      "Constraint severity: conflict detected with correct values",
    );
  }

  // Constraint: same name, different scope → conflict
  {
    const a = makeModel(
      "A",
      [
        { name: "User", type: "actor", description: "user" },
        { name: "DB", type: "system", description: "db" },
      ],
      [],
      [{ name: "AccessRule", severity: "hard", scope: ["User"] }],
    );
    const b = makeModel(
      "B",
      [
        { name: "User", type: "actor", description: "user" },
        { name: "DB", type: "system", description: "db" },
      ],
      [],
      [{ name: "AccessRule", severity: "hard", scope: ["User", "DB"] }],
    );
    const r = compare(a, b);
    assert(
      r.conflicts.some((c) => c.kind === "constraint_scope"),
      "Constraint scope: conflict detected",
    );
  }

  // Two fully identical models with processes and constraints → zero conflicts
  {
    const model = makeModel(
      "A",
      [{ name: "Server", type: "system", description: "server" }],
      [],
      [{ name: "Uptime", severity: "hard", scope: ["Server"] }],
      [
        {
          name: "Boot",
          trigger: "power on",
          steps: [
            { order: 1, action: "init" },
            { order: 2, action: "ready" },
          ],
        },
      ],
    );
    const r = compare(model, model);
    assert(r.conflicts.length === 0, "Identical full model: zero conflicts");
    assert(
      r.agreements === 3,
      "Identical full model: 3 agreements (entity + process + constraint)",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
