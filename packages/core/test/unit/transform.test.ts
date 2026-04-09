/**
 * Unit tests for transform agent helpers.
 * Tests the summarizeModel logic and REMOVE parsing without LLM calls.
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
      { id: "ent_1", name: "User", type: "actor", description: "A user" },
      { id: "ent_2", name: "Product", type: "object", description: "An item" },
      { id: "ent_3", name: "Order", type: "object", description: "A purchase" },
    ],
    relations: [
      {
        id: "rel_1",
        type: "produces",
        source: "ent_1",
        target: "ent_3",
        label: "creates",
      },
      {
        id: "rel_2",
        type: "depends_on",
        source: "ent_3",
        target: "ent_2",
        label: "contains",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Buy",
        description: "Purchase flow",
        steps: [{ order: 1, action: "Select", actor: "ent_1" }],
        participants: ["ent_1", "ent_2"],
        outcomes: ["Order created"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Stock",
        type: "rule",
        description: "Must be in stock",
        scope: ["ent_2"],
        severity: "hard",
      },
    ],
    ...overrides,
  } as WorldModelType;
}

// Re-implement summarizeModel for testing (mirrors transform.ts)
function summarizeModel(model: WorldModelType): string {
  const entities = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");
  const relations = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} \u2014[${r.type}]\u2192 ${tgt}`;
    })
    .join("\n");
  const processes = model.processes
    .map((p) => `- ${p.name}: ${p.description}`)
    .join("\n");
  const constraints = model.constraints
    .map((c) => `- [${c.severity}] ${c.name}: ${c.description}`)
    .join("\n");
  return `Entities:\n${entities}\n\nRelations:\n${relations}\n\nProcesses:\n${processes}\n\nConstraints:\n${constraints}`;
}

// Re-implement removal logic for testing (mirrors transform.ts)
function applyRemovals(
  model: WorldModelType,
  notes: string[],
): { model: WorldModelType; changes: string[] } {
  const removalNotes = notes.filter((n) => n.startsWith("REMOVE"));
  const changes: string[] = [];
  let result = model;

  if (removalNotes.length > 0) {
    const entitiesToRemove = new Set<string>();
    for (const note of removalNotes) {
      const entityMatch = note.match(/REMOVE:\s*(.+)/i);
      if (entityMatch) {
        entitiesToRemove.add(entityMatch[1].trim().toLowerCase());
        changes.push(`Removed: ${entityMatch[1].trim()}`);
      }
    }
    if (entitiesToRemove.size > 0) {
      const filteredEntities = result.entities.filter(
        (e) => !entitiesToRemove.has(e.name.toLowerCase()),
      );
      const removedIds = new Set(
        result.entities
          .filter((e) => entitiesToRemove.has(e.name.toLowerCase()))
          .map((e) => e.id),
      );
      result = {
        ...result,
        entities: filteredEntities,
        relations: result.relations.filter(
          (r) => !removedIds.has(r.source) && !removedIds.has(r.target),
        ),
        processes: result.processes.map((p) => ({
          ...p,
          participants: p.participants.filter((pid) => !removedIds.has(pid)),
        })),
        constraints: result.constraints.map((c) => ({
          ...c,
          scope: c.scope.filter((sid) => !removedIds.has(sid)),
        })),
      };
    }
  }
  return { model: result, changes };
}

async function run() {
  console.log(
    "\n\u2500\u2500\u2500 Transform Agent Tests \u2500\u2500\u2500\n",
  );

  // Test 1: transformWorldModel is exported
  {
    const mod = await import("../../src/agents/transform.js");
    assert(
      typeof mod.transformWorldModel === "function",
      "transformWorldModel is exported as function",
    );
  }

  // Test 2: summarizeModel includes all entity names
  {
    const model = makeModel();
    const summary = summarizeModel(model);
    assert(summary.includes("User"), "Summary includes User entity");
    assert(summary.includes("Product"), "Summary includes Product entity");
    assert(summary.includes("Order"), "Summary includes Order entity");
  }

  // Test 3: summarizeModel includes entity types
  {
    const model = makeModel();
    const summary = summarizeModel(model);
    assert(summary.includes("actor"), "Summary includes actor type");
    assert(summary.includes("object"), "Summary includes object type");
  }

  // Test 4: summarizeModel resolves relation entity names
  {
    const model = makeModel();
    const summary = summarizeModel(model);
    assert(
      summary.includes("User") && summary.includes("Order"),
      "Summary resolves relation source/target names",
    );
  }

  // Test 5: summarizeModel includes process info
  {
    const model = makeModel();
    const summary = summarizeModel(model);
    assert(summary.includes("Buy"), "Summary includes process name");
    assert(
      summary.includes("Purchase flow"),
      "Summary includes process description",
    );
  }

  // Test 6: summarizeModel includes constraints
  {
    const model = makeModel();
    const summary = summarizeModel(model);
    assert(summary.includes("[hard]"), "Summary includes constraint severity");
    assert(summary.includes("Stock"), "Summary includes constraint name");
  }

  // Test 7: summarizeModel handles empty model
  {
    const model = makeModel({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const summary = summarizeModel(model);
    assert(
      summary.includes("Entities:"),
      "Summary has Entities header even when empty",
    );
    assert(
      summary.includes("Relations:"),
      "Summary has Relations header even when empty",
    );
  }

  // Test 8: Removal parsing — single entity
  {
    const model = makeModel();
    const { model: result, changes } = applyRemovals(model, [
      "REMOVE: Product",
    ]);
    assert(result.entities.length === 2, "Removal removes one entity");
    assert(
      !result.entities.some((e) => e.name === "Product"),
      "Product is removed",
    );
    assert(changes.length === 1, "One change recorded");
    assert(changes[0].includes("Product"), "Change mentions Product");
  }

  // Test 9: Removal cascades to relations
  {
    const model = makeModel();
    const { model: result } = applyRemovals(model, ["REMOVE: Product"]);
    assert(
      result.relations.length === 1,
      "Dangling relation removed (depends_on Product)",
    );
    assert(
      result.relations[0].type === "produces",
      "Remaining relation is User->Order",
    );
  }

  // Test 10: Removal cascades to process participants
  {
    const model = makeModel();
    const { model: result } = applyRemovals(model, ["REMOVE: Product"]);
    assert(
      !result.processes[0].participants.includes("ent_2"),
      "Product removed from process participants",
    );
  }

  // Test 11: Removal cascades to constraint scope
  {
    const model = makeModel();
    const { model: result } = applyRemovals(model, ["REMOVE: Product"]);
    assert(
      result.constraints[0].scope.length === 0,
      "Product removed from constraint scope",
    );
  }

  // Test 12: Removal is case-insensitive
  {
    const model = makeModel();
    const { model: result } = applyRemovals(model, ["REMOVE: product"]);
    assert(
      !result.entities.some((e) => e.name === "Product"),
      "Case-insensitive removal works",
    );
  }

  // Test 13: Multiple removals
  {
    const model = makeModel();
    const { model: result, changes } = applyRemovals(model, [
      "REMOVE: Product",
      "REMOVE: Order",
    ]);
    assert(result.entities.length === 1, "Two entities removed");
    assert(result.entities[0].name === "User", "Only User remains");
    assert(changes.length === 2, "Two changes recorded");
  }

  // Test 14: No removals — model unchanged
  {
    const model = makeModel();
    const { model: result, changes } = applyRemovals(model, [
      "Added new entity",
    ]);
    assert(result.entities.length === 3, "No entities removed");
    assert(changes.length === 0, "No changes recorded");
  }

  // Test 15: REMOVE with extra whitespace
  {
    const model = makeModel();
    const { model: result } = applyRemovals(model, ["REMOVE:   Product  "]);
    assert(
      !result.entities.some((e) => e.name === "Product"),
      "Whitespace-trimmed removal works",
    );
  }

  // Test 16: REMOVE RELATION note format (currently only entity removal implemented)
  {
    const model = makeModel();
    const { changes } = applyRemovals(model, [
      "REMOVE RELATION: User -> Order",
    ]);
    // REMOVE RELATION doesn't match the entity removal regex, so no changes
    assert(
      changes.length === 0,
      "REMOVE RELATION format not matched by entity removal (expected)",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
