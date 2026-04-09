/**
 * Unit tests for refinement agent helpers.
 * Tests summarizeModel (with truncation) and module exports.
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
        name: "Server",
        type: "system",
        description: "Main application server handling all requests",
      },
      {
        id: "ent_2",
        name: "Client",
        type: "actor",
        description: "End user of the system",
      },
    ],
    relations: [
      {
        id: "rel_1",
        type: "communicates_with",
        source: "ent_2",
        target: "ent_1",
        label: "sends requests to",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Request Handling",
        description: "Process incoming HTTP requests",
        steps: [{ order: 1, action: "Receive request", actor: "ent_1" }],
        participants: ["ent_1", "ent_2"],
        outcomes: ["Response sent"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Rate Limit",
        type: "capacity",
        description: "Max 100 requests per second per client",
        scope: ["ent_2"],
        severity: "hard",
      },
    ],
    ...overrides,
  } as WorldModelType;
}

// Mirror refinement.ts summarizeModel (with truncation)
function summarizeModel(model: WorldModelType): string {
  const entityList = model.entities
    .map((e) => `  - ${e.name} (${e.type}): ${e.description.slice(0, 100)}`)
    .join("\n");
  const relationList = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `  - ${src} \u2014[${r.type}]\u2192 ${tgt}`;
    })
    .join("\n");
  const processList = model.processes
    .map((p) => `  - ${p.name}: ${p.description.slice(0, 80)}`)
    .join("\n");
  const constraintList = model.constraints
    .map((c) => `  - [${c.severity}] ${c.name}: ${c.description.slice(0, 80)}`)
    .join("\n");
  return `Entities (${model.entities.length}):\n${entityList}\n\nRelations (${model.relations.length}):\n${relationList}\n\nProcesses (${model.processes.length}):\n${processList}\n\nConstraints (${model.constraints.length}):\n${constraintList}`;
}

async function run() {
  console.log(
    "\n\u2500\u2500\u2500 Refinement Agent Tests \u2500\u2500\u2500\n",
  );

  // Test 1: refineWorldModel is exported
  {
    const mod = await import("../../src/agents/refinement.js");
    assert(
      typeof mod.refineWorldModel === "function",
      "refineWorldModel is exported",
    );
  }

  // Test 2: Summary has correct entity count
  {
    const s = summarizeModel(makeModel());
    assert(s.includes("Entities (2)"), "Entity count header correct");
  }

  // Test 3: Summary has correct relation count
  {
    const s = summarizeModel(makeModel());
    assert(s.includes("Relations (1)"), "Relation count header correct");
  }

  // Test 4: Summary includes entity names with types
  {
    const s = summarizeModel(makeModel());
    assert(s.includes("Server (system)"), "Entity name + type present");
    assert(s.includes("Client (actor)"), "Second entity present");
  }

  // Test 5: Summary resolves relation names
  {
    const s = summarizeModel(makeModel());
    assert(
      s.includes("Client") &&
        s.includes("Server") &&
        s.includes("communicates_with"),
      "Relation shows resolved names",
    );
  }

  // Test 6: Description truncation at 100 chars for entities
  {
    const longDesc = "A".repeat(150);
    const model = makeModel({
      entities: [
        { id: "ent_1", name: "Long", type: "concept", description: longDesc },
      ],
    });
    const s = summarizeModel(model);
    // Should contain first 100 chars but not all 150
    assert(
      s.includes("A".repeat(100)),
      "First 100 chars of description present",
    );
    assert(!s.includes("A".repeat(101)), "Description truncated at 100");
  }

  // Test 7: Description truncation at 80 chars for processes
  {
    const longDesc = "B".repeat(120);
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Long",
          description: longDesc,
          steps: [],
          participants: [],
          outcomes: [],
        },
      ],
    });
    const s = summarizeModel(model);
    assert(
      s.includes("B".repeat(80)),
      "Process description first 80 chars present",
    );
    assert(!s.includes("B".repeat(81)), "Process description truncated at 80");
  }

  // Test 8: Description truncation at 80 chars for constraints
  {
    const longDesc = "C".repeat(120);
    const model = makeModel({
      constraints: [
        {
          id: "cstr_1",
          name: "Long",
          type: "rule",
          description: longDesc,
          scope: [],
          severity: "soft",
        },
      ],
    });
    const s = summarizeModel(model);
    assert(
      s.includes("C".repeat(80)),
      "Constraint description first 80 chars present",
    );
    assert(
      !s.includes("C".repeat(81)),
      "Constraint description truncated at 80",
    );
  }

  // Test 9: Empty model
  {
    const s = summarizeModel(
      makeModel({
        entities: [],
        relations: [],
        processes: [],
        constraints: [],
      }),
    );
    assert(s.includes("Entities (0)"), "Empty model has zero entities");
    assert(s.includes("Relations (0)"), "Empty model has zero relations");
    assert(s.includes("Processes (0)"), "Empty model has zero processes");
    assert(s.includes("Constraints (0)"), "Empty model has zero constraints");
  }

  // Test 10: Unresolved relation entity falls back to ID
  {
    const model = makeModel({
      entities: [{ id: "ent_1", name: "A", type: "actor", description: "a" }],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_missing",
          label: "refs",
        },
      ],
    });
    const s = summarizeModel(model);
    assert(s.includes("ent_missing"), "Unresolved target falls back to ID");
  }

  // Test 11: Constraint severity is shown
  {
    const s = summarizeModel(makeModel());
    assert(s.includes("[hard]"), "Hard severity shown");
  }

  // Test 12: Process name and description present
  {
    const s = summarizeModel(makeModel());
    assert(
      s.includes("Request Handling: Process incoming"),
      "Process name + description present",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
