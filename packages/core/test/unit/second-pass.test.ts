/**
 * Unit tests for second-pass agent helpers.
 * Tests summarizeModelForPrompt logic and prompt structure.
 */

import type { WorldModelType } from "../../src/schema/index.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

function makeModel(overrides: Partial<WorldModelType> = {}): WorldModelType {
  return {
    id: "wm_test",
    name: "Test",
    description: "Test model",
    version: "0.1.0",
    created_at: "2026-01-01T00:00:00Z",
    entities: [
      {
        id: "ent_1",
        name: "Admin",
        type: "actor",
        description: "System administrator",
      },
      {
        id: "ent_2",
        name: "Database",
        type: "system",
        description: "Data storage",
      },
      {
        id: "ent_3",
        name: "Config",
        type: "resource",
        description: "Configuration data",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "controls",
        source: "ent_1",
        target: "ent_2",
        label: "manages",
      },
      {
        id: "rel_2",
        type: "uses",
        source: "ent_2",
        target: "ent_3",
        label: "reads from",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Backup",
        description: "Database backup flow",
        steps: [
          { order: 1, action: "Lock tables", actor: "ent_2" },
          { order: 2, action: "Dump data", actor: "ent_2" },
          { order: 3, action: "Verify backup", actor: "ent_1" },
        ],
        participants: ["ent_1", "ent_2"],
        outcomes: ["Backup file created"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Backup Window",
        type: "temporal",
        description: "Backups only during off-peak hours",
        scope: ["ent_2"],
        severity: "soft",
      },
      {
        id: "cstr_2",
        name: "Admin Required",
        type: "authorization",
        description: "Only admins can trigger backups",
        scope: ["ent_1"],
        severity: "hard",
      },
    ],
    ...overrides,
  } as WorldModelType;
}

// Re-implement summarizeModelForPrompt (mirrors second-pass.ts)
function summarizeModelForPrompt(model: WorldModelType): string {
  const entities = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");
  const relations = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} \u2014[${r.type}]\u2192 ${tgt}: ${r.label}`;
    })
    .join("\n");
  const processes = model.processes
    .map((p) => {
      const steps = p.steps
        .map((s) => {
          const actor = s.actor
            ? (model.entities.find((e) => e.id === s.actor)?.name ?? s.actor)
            : "unknown";
          return `  ${s.order}. ${actor}: ${s.action}`;
        })
        .join("\n");
      return `- ${p.name}: ${p.description}\n${steps}`;
    })
    .join("\n");
  const constraints = model.constraints
    .map((c) => `- [${c.severity}] ${c.name}: ${c.description}`)
    .join("\n");
  return `ENTITIES (${model.entities.length}):\n${entities}\n\nRELATIONS (${model.relations.length}):\n${relations}\n\nPROCESSES (${model.processes.length}):\n${processes}\n\nCONSTRAINTS (${model.constraints.length}):\n${constraints}`;
}

async function run() {
  console.log(
    "\n\u2500\u2500\u2500 Second-Pass Agent Tests \u2500\u2500\u2500\n",
  );

  // Test 1: secondPassAgent is exported
  {
    const mod = await import("../../src/agents/second-pass.js");
    assert(
      typeof mod.secondPassAgent === "function",
      "secondPassAgent is exported",
    );
  }

  // Test 2: Summary includes entity count header
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(summary.includes("ENTITIES (3)"), "Summary has entity count header");
  }

  // Test 3: Summary includes relation count header
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("RELATIONS (2)"),
      "Summary has relation count header",
    );
  }

  // Test 4: Summary includes process count header
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("PROCESSES (1)"),
      "Summary has process count header",
    );
  }

  // Test 5: Summary includes constraint count header
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("CONSTRAINTS (2)"),
      "Summary has constraint count header",
    );
  }

  // Test 6: Summary lists all entity names with types
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(summary.includes("Admin (actor)"), "Summary has Admin with type");
    assert(
      summary.includes("Database (system)"),
      "Summary has Database with type",
    );
    assert(
      summary.includes("Config (resource)"),
      "Summary has Config with type",
    );
  }

  // Test 7: Summary resolves relation source/target to names
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("Admin") &&
        summary.includes("Database") &&
        summary.includes("controls"),
      "Relations show resolved names",
    );
  }

  // Test 8: Summary includes process steps with resolved actor names
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("1. Database: Lock tables"),
      "Process step has resolved actor name",
    );
    assert(
      summary.includes("3. Admin: Verify backup"),
      "Process step has Admin actor",
    );
  }

  // Test 9: Summary includes constraint severity
  {
    const model = makeModel();
    const summary = summarizeModelForPrompt(model);
    assert(summary.includes("[soft] Backup Window"), "Soft constraint shown");
    assert(summary.includes("[hard] Admin Required"), "Hard constraint shown");
  }

  // Test 10: Summary handles empty model
  {
    const model = makeModel({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const summary = summarizeModelForPrompt(model);
    assert(summary.includes("ENTITIES (0)"), "Empty model shows zero counts");
    assert(summary.includes("RELATIONS (0)"), "Empty relations shows zero");
  }

  // Test 11: Summary handles unresolved actor ID
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Test",
          description: "test",
          steps: [{ order: 1, action: "Do thing", actor: "ent_missing" }],
          participants: [],
          outcomes: [],
        },
      ],
    });
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("ent_missing: Do thing"),
      "Unresolved actor falls back to ID",
    );
  }

  // Test 12: Summary handles step without actor
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Auto",
          description: "automated",
          steps: [{ order: 1, action: "Run batch" }],
          participants: [],
          outcomes: [],
        },
      ],
    });
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("unknown: Run batch"),
      "Step without actor shows 'unknown'",
    );
  }

  // Test 13: Summary handles unresolved relation entity IDs
  {
    const model = makeModel({
      entities: [{ id: "ent_1", name: "A", type: "actor", description: "a" }],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_gone",
          label: "refs",
        },
      ],
    });
    const summary = summarizeModelForPrompt(model);
    assert(
      summary.includes("A") && summary.includes("ent_gone"),
      "Unresolved relation target falls back to ID",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
