/**
 * Unit tests for the structuring agent.
 * No LLM calls — tests deterministic ID assignment, type normalization, entity resolution.
 */

import { structuringAgent } from "../../src/agents/structuring.js";
import { WorldModel } from "../../src/schema/world-model.js";
import type { RawExtraction } from "../../src/agents/extraction.js";
import type { PipelineInput } from "../../src/pipeline/index.js";

const input: PipelineInput = { raw: "test", sourceType: "text" };

function makeExtraction(overrides: Partial<RawExtraction> = {}): RawExtraction {
  return {
    entities: [
      { name: "User", type: "actor", description: "A user of the system" },
      { name: "Database", type: "system", description: "The main database" },
    ],
    relations: [
      { source: "User", target: "Database", type: "uses", label: "queries" },
    ],
    processes: [
      {
        name: "Login",
        description: "User login flow",
        steps: [{ order: 1, action: "Enter credentials", actor: "User" }],
        participants: ["User", "Database"],
        outcomes: ["Authenticated session"],
      },
    ],
    constraints: [
      {
        name: "Rate Limit",
        type: "capacity",
        description: "Max 100 req/s",
        scope: ["Database"],
        severity: "hard" as const,
      },
    ],
    model_name: "Test Model",
    model_description: "A test model",
    source_summary: "test input",
    confidence: 0.8,
    extraction_notes: [],
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

async function run() {
  console.log("═══ Structuring Agent Unit Tests ═══\n");

  // Test 1: Basic structuring
  {
    const { worldModel } = await structuringAgent({
      input,
      extraction: makeExtraction(),
    });
    assert(
      worldModel.entities.length === 2,
      "Creates correct number of entities",
    );
    assert(
      worldModel.relations.length === 1,
      "Creates correct number of relations",
    );
    assert(
      worldModel.processes.length === 1,
      "Creates correct number of processes",
    );
    assert(
      worldModel.constraints.length === 1,
      "Creates correct number of constraints",
    );
  }

  // Test 2: ID prefixes
  {
    const { worldModel } = await structuringAgent({
      input,
      extraction: makeExtraction(),
    });
    assert(
      worldModel.entities.every((e) => e.id.startsWith("ent_")),
      "Entity IDs have ent_ prefix",
    );
    assert(
      worldModel.relations.every((r) => r.id.startsWith("rel_")),
      "Relation IDs have rel_ prefix",
    );
    assert(
      worldModel.processes.every((p) => p.id.startsWith("proc_")),
      "Process IDs have proc_ prefix",
    );
    assert(
      worldModel.constraints.every((c) => c.id.startsWith("cstr_")),
      "Constraint IDs have cstr_ prefix",
    );
  }

  // Test 3: ID uniqueness
  {
    const { worldModel } = await structuringAgent({
      input,
      extraction: makeExtraction(),
    });
    const allIds = [
      ...worldModel.entities.map((e) => e.id),
      ...worldModel.relations.map((r) => r.id),
      ...worldModel.processes.map((p) => p.id),
      ...worldModel.constraints.map((c) => c.id),
    ];
    assert(new Set(allIds).size === allIds.length, "All IDs are unique");
  }

  // Test 4: Entity type normalization
  {
    const ext = makeExtraction({
      entities: [
        { name: "Admin", type: "person", description: "An admin" },
        { name: "Corp", type: "organization", description: "A corporation" },
        { name: "Server", type: "service", description: "A server" },
        { name: "City", type: "place", description: "A city" },
        {
          name: "Widget",
          type: "totally_invalid_type",
          description: "A widget",
        },
      ],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    const types = worldModel.entities.map((e) => e.type);
    assert(types[0] === "actor", "Normalizes 'person' → 'actor'");
    assert(types[1] === "group", "Normalizes 'organization' → 'group'");
    assert(types[2] === "system", "Normalizes 'service' → 'system'");
    assert(types[3] === "location", "Normalizes 'place' → 'location'");
    assert(types[4] === "object", "Falls back to 'object' for unknown types");
  }

  // Test 5: Relation type normalization
  {
    const ext = makeExtraction({
      entities: [
        { name: "A", type: "object", description: "A" },
        { name: "B", type: "object", description: "B" },
      ],
      relations: [
        { source: "A", target: "B", type: "totally_bogus", label: "test" },
        { source: "A", target: "B", type: "depends_on", label: "test2" },
      ],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.relations[0].type === "uses",
      "Falls back to 'uses' for unknown relation types",
    );
    assert(
      worldModel.relations[1].type === "depends_on",
      "Preserves valid relation types",
    );
  }

  // Test 6: Unresolved entity references create placeholders
  {
    const ext = makeExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
      relations: [
        { source: "User", target: "NonExistent", type: "uses", label: "test" },
      ],
      processes: [],
      constraints: [],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.entities.length === 2,
      "Creates placeholder for unresolved reference",
    );
    const placeholder = worldModel.entities.find(
      (e) => e.name === "NonExistent",
    );
    assert(!!placeholder, "Placeholder has correct name");
    assert(
      placeholder?.tags?.includes("auto-created") ?? false,
      "Placeholder is tagged as auto-created",
    );
  }

  // Test 7: Process step order defaults
  {
    const ext = makeExtraction({
      processes: [
        {
          name: "Flow",
          description: "A flow",
          steps: [
            { order: undefined as unknown as number, action: "Step A" },
            { order: undefined as unknown as number, action: "Step B" },
            { order: undefined as unknown as number, action: "Step C" },
          ],
          participants: ["User"],
          outcomes: ["Done"],
        },
      ],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    const orders = worldModel.processes[0].steps.map((s) => s.order);
    assert(
      JSON.stringify(orders) === "[1,2,3]",
      "Defaults step order to 1-indexed sequence",
    );
  }

  // Test 8: Zod schema validation passes
  {
    const { worldModel } = await structuringAgent({
      input,
      extraction: makeExtraction(),
    });
    const result = WorldModel.safeParse(worldModel);
    assert(result.success, "Output passes Zod WorldModel schema validation");
  }

  // Test 9: Empty extraction
  {
    const ext = makeExtraction({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.entities.length === 0,
      "Handles empty extraction — 0 entities",
    );
    assert(
      worldModel.relations.length === 0,
      "Handles empty extraction — 0 relations",
    );
  }

  // Test 10: Constraint type normalization
  {
    const ext = makeExtraction({
      entities: [{ name: "X", type: "object", description: "X" }],
      constraints: [
        {
          name: "C1",
          type: "bogus_type",
          description: "test",
          scope: ["X"],
          severity: "hard" as const,
        },
        {
          name: "C2",
          type: "temporal",
          description: "test",
          scope: ["X"],
          severity: "soft" as const,
        },
      ],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.constraints[0].type === "rule",
      "Falls back to 'rule' for unknown constraint types",
    );
    assert(
      worldModel.constraints[1].type === "temporal",
      "Preserves valid constraint types",
    );
  }

  // Test 11: Case-insensitive entity name resolution
  {
    const ext = makeExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
      relations: [
        {
          source: "user",
          target: "User",
          type: "uses",
          label: "self-ref via lowercase",
        },
        {
          source: "USER",
          target: "User",
          type: "uses",
          label: "self-ref via uppercase",
        },
      ],
      processes: [],
      constraints: [],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.entities.length === 1,
      "Case-insensitive: no duplicate entities created for 'user'/'USER'/'User'",
    );
    assert(
      worldModel.relations.every((r) => r.source === r.target),
      "Case-insensitive: all variants resolve to same ID",
    );
  }

  // Test 12: Trimmed name resolution
  {
    const ext = makeExtraction({
      entities: [{ name: "Database", type: "system", description: "DB" }],
      relations: [
        {
          source: " Database ",
          target: "Database",
          type: "uses",
          label: "whitespace variant",
        },
      ],
      processes: [],
      constraints: [],
    });
    const { worldModel } = await structuringAgent({ input, extraction: ext });
    assert(
      worldModel.entities.length === 1,
      "Trimmed: no duplicate for ' Database ' vs 'Database'",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
