import { fixWorldModel } from "../../src/utils/fix.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(overrides: Partial<WorldModelType> = {}): WorldModelType {
  return {
    id: "wm_test",
    name: "Test",
    description: "Test",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [
      { id: "ent_1", name: "User", type: "actor", description: "A user" },
      { id: "ent_2", name: "DB", type: "system", description: "Database" },
    ],
    relations: [
      {
        id: "rel_1",
        type: "uses",
        source: "ent_1",
        target: "ent_2",
        label: "queries",
      },
    ],
    processes: [
      {
        id: "proc_1",
        name: "Login",
        description: "Login",
        steps: [{ order: 1, action: "auth", actor: "ent_1" }],
        participants: ["ent_1", "ent_2"],
        outcomes: ["session"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Limit",
        type: "rule",
        description: "limit",
        scope: ["ent_2"],
        severity: "hard",
      },
    ],
    ...overrides,
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
  console.log("═══ Fix Unit Tests ═══\n");

  // Clean model: no fixes needed
  {
    const { fixes } = fixWorldModel(makeModel());
    assert(fixes.length === 0, "Clean model: no fixes");
  }

  // Dangling relation removed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        relations: [
          {
            id: "rel_1",
            type: "uses",
            source: "ent_1",
            target: "ent_gone",
            label: "bad",
          },
        ],
      }),
    );
    assert(model.relations.length === 0, "Dangling rel: removed");
    assert(
      fixes.some((f) => f.includes("dangling")),
      "Dangling rel: fix reported",
    );
  }

  // Self-referencing relation removed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        relations: [
          {
            id: "rel_1",
            type: "uses",
            source: "ent_1",
            target: "ent_2",
            label: "ok",
          },
          {
            id: "rel_2",
            type: "uses",
            source: "ent_1",
            target: "ent_1",
            label: "self",
          },
        ],
      }),
    );
    assert(model.relations.length === 1, "Self-ref: removed");
    assert(
      fixes.some((f) => f.includes("self-referencing")),
      "Self-ref: fix reported",
    );
  }

  // Orphan entity removed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        entities: [
          { id: "ent_1", name: "User", type: "actor", description: "A user" },
          { id: "ent_2", name: "DB", type: "system", description: "Database" },
          {
            id: "ent_3",
            name: "Orphan",
            type: "object",
            description: "Nobody references me",
          },
        ],
      }),
    );
    assert(model.entities.length === 2, "Orphan: removed");
    assert(
      !model.entities.some((e) => e.name === "Orphan"),
      "Orphan: correct entity removed",
    );
    assert(
      fixes.some((f) => f.includes("orphan")),
      "Orphan: fix reported",
    );
  }

  // Empty process removed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        processes: [
          {
            id: "proc_1",
            name: "Login",
            description: "Login",
            steps: [{ order: 1, action: "auth", actor: "ent_1" }],
            participants: ["ent_1"],
            outcomes: ["session"],
          },
          {
            id: "proc_2",
            name: "Empty",
            description: "No steps",
            steps: [],
            participants: ["ent_1"],
            outcomes: [],
          },
        ],
      }),
    );
    assert(model.processes.length === 1, "Empty process: removed");
    assert(
      fixes.some((f) => f.includes("empty")),
      "Empty process: fix reported",
    );
  }

  // Unsorted steps fixed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        processes: [
          {
            id: "proc_1",
            name: "Flow",
            description: "test",
            steps: [
              { order: 3, action: "c" },
              { order: 1, action: "a" },
              { order: 2, action: "b" },
            ],
            participants: ["ent_1"],
            outcomes: ["done"],
          },
        ],
      }),
    );
    const orders = model.processes[0].steps.map((s) => s.order);
    assert(JSON.stringify(orders) === "[1,2,3]", "Unsorted steps: reordered");
    assert(
      fixes.some((f) => f.includes("Sorted")),
      "Unsorted steps: fix reported",
    );
  }

  // Duplicate relations removed
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        relations: [
          {
            id: "rel_1",
            type: "uses",
            source: "ent_1",
            target: "ent_2",
            label: "a",
          },
          {
            id: "rel_2",
            type: "uses",
            source: "ent_1",
            target: "ent_2",
            label: "b",
          },
        ],
      }),
    );
    assert(model.relations.length === 1, "Duplicate rels: deduplicated");
    assert(
      fixes.some((f) => f.includes("duplicate")),
      "Duplicate rels: fix reported",
    );
  }

  // Dangling process participants cleaned
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        processes: [
          {
            id: "proc_1",
            name: "Flow",
            description: "test",
            steps: [{ order: 1, action: "do", actor: "ent_1" }],
            participants: ["ent_1", "ent_gone"],
            outcomes: ["done"],
          },
        ],
      }),
    );
    assert(
      model.processes[0].participants.length === 1,
      "Dangling participant: cleaned",
    );
    assert(
      fixes.some((f) => f.includes("participants")),
      "Dangling participant: fix reported",
    );
  }

  // Dangling step actor cleared
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        processes: [
          {
            id: "proc_1",
            name: "Flow",
            description: "test",
            steps: [{ order: 1, action: "do", actor: "ent_gone" }],
            participants: ["ent_1"],
            outcomes: ["done"],
          },
        ],
      }),
    );
    assert(
      model.processes[0].steps[0].actor === undefined,
      "Dangling actor: cleared",
    );
    assert(
      fixes.some((f) => f.includes("dangling step actors")),
      "Dangling actor: fix reported",
    );
  }

  // Duplicate step orders renumbered
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        processes: [
          {
            id: "proc_1",
            name: "Flow",
            description: "test",
            steps: [
              { order: 1, action: "a" },
              { order: 1, action: "b" },
              { order: 1, action: "c" },
            ],
            participants: ["ent_1"],
            outcomes: ["done"],
          },
        ],
      }),
    );
    const orders = model.processes[0].steps.map((s) => s.order);
    assert(
      JSON.stringify(orders) === "[1,2,3]",
      "Dupe orders: renumbered sequentially",
    );
    assert(
      fixes.some((f) => f.includes("Renumbered")),
      "Dupe orders: fix reported",
    );
  }

  // Duplicate entities merged
  {
    const { model, fixes } = fixWorldModel(
      makeModel({
        entities: [
          { id: "ent_1", name: "User", type: "actor", description: "A user" },
          {
            id: "ent_2",
            name: "user",
            type: "actor",
            description: "A detailed user description that is longer",
          },
          { id: "ent_3", name: "DB", type: "system", description: "Database" },
        ],
        relations: [
          {
            id: "rel_1",
            type: "uses",
            source: "ent_2",
            target: "ent_3",
            label: "queries",
          },
        ],
        processes: [],
        constraints: [],
      }),
    );
    assert(model.entities.length === 2, "Entity dedup: merged 2 Users into 1");
    const user = model.entities.find((e) => e.name.toLowerCase() === "user");
    assert(
      user!.description.includes("detailed"),
      "Entity dedup: kept longer description",
    );
    assert(
      model.relations[0].source === user!.id,
      "Entity dedup: relation remapped to keeper",
    );
    assert(
      fixes.some((f) => f.includes("Merged")),
      "Entity dedup: fix reported",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
