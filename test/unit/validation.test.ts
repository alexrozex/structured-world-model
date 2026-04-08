/**
 * Unit tests for the validation agent.
 * No LLM calls — tests all validation issue codes.
 */

import { validationAgent } from "../../src/agents/validation.js";
import type { WorldModelType } from "../../src/schema/index.js";
import type { PipelineInput } from "../../src/pipeline/index.js";

const input: PipelineInput = { raw: "test", sourceType: "text" };

function makeModel(overrides: Partial<WorldModelType> = {}): WorldModelType {
  return {
    id: "wm_test",
    name: "Test",
    description: "Test model",
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
        description: "Login flow",
        steps: [{ order: 1, action: "Enter creds", actor: "ent_1" }],
        participants: ["ent_1", "ent_2"],
        outcomes: ["Session"],
      },
    ],
    constraints: [
      {
        id: "cstr_1",
        name: "Rate Limit",
        type: "capacity",
        description: "Max 100",
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

function hasIssue(issues: Array<{ code: string }>, code: string): boolean {
  return issues.some((i) => i.code === code);
}

async function run() {
  console.log("═══ Validation Agent Unit Tests ═══\n");

  // Test 1: Valid model passes
  {
    const { validation } = await validationAgent({
      input,
      worldModel: makeModel(),
    });
    assert(validation.valid, "Valid model passes validation");
    assert(
      !validation.issues.some((i) => i.type === "error"),
      "No errors on valid model",
    );
  }

  // Test 2: Dangling relation source
  {
    const model = makeModel({
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_nonexistent",
          target: "ent_2",
          label: "test",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DANGLING_REL_SOURCE"),
      "Detects dangling relation source",
    );
  }

  // Test 3: Dangling relation target
  {
    const model = makeModel({
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_nonexistent",
          label: "test",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DANGLING_REL_TARGET"),
      "Detects dangling relation target",
    );
  }

  // Test 4: Self-relation warning
  {
    const model = makeModel({
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_1",
          label: "self-ref",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "SELF_RELATION"),
      "Detects self-relations",
    );
  }

  // Test 5: Dangling process participant
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Flow",
          description: "test",
          steps: [{ order: 1, action: "do" }],
          participants: ["ent_nonexistent"],
          outcomes: ["done"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DANGLING_PROC_PARTICIPANT"),
      "Detects dangling process participant",
    );
  }

  // Test 6: Dangling step actor
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Flow",
          description: "test",
          steps: [{ order: 1, action: "do", actor: "ent_nonexistent" }],
          participants: ["ent_1"],
          outcomes: ["done"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DANGLING_STEP_ACTOR"),
      "Detects dangling step actor",
    );
  }

  // Test 7: Empty process warning
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Empty",
          description: "test",
          steps: [],
          participants: ["ent_1"],
          outcomes: ["nothing"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "EMPTY_PROCESS"),
      "Detects empty processes",
    );
  }

  // Test 8: Dangling constraint scope
  {
    const model = makeModel({
      constraints: [
        {
          id: "cstr_1",
          name: "C",
          type: "rule",
          description: "test",
          scope: ["ent_nonexistent"],
          severity: "hard",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DANGLING_CONSTRAINT_SCOPE"),
      "Detects dangling constraint scope",
    );
  }

  // Test 9: Orphan entity
  {
    const model = makeModel({
      entities: [
        { id: "ent_1", name: "User", type: "actor", description: "A user" },
        { id: "ent_2", name: "DB", type: "system", description: "Database" },
        {
          id: "ent_3",
          name: "Orphan",
          type: "object",
          description: "Not referenced anywhere",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "ORPHAN_ENTITY"),
      "Detects orphan entities",
    );
  }

  // Test 10: Duplicate entity names
  {
    const model = makeModel({
      entities: [
        { id: "ent_1", name: "User", type: "actor", description: "A user" },
        {
          id: "ent_2",
          name: "User",
          type: "actor",
          description: "Another user",
        },
      ],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "test",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DUPLICATE_ENTITY_NAME"),
      "Detects duplicate entity names",
    );
  }

  // Test 11: No entities error
  {
    const model = makeModel({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(hasIssue(validation.issues, "NO_ENTITIES"), "Detects zero entities");
    assert(!validation.valid, "Model with no entities is invalid");
  }

  // Test 12: No relations warning
  {
    const model = makeModel({ relations: [] });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "NO_RELATIONS"),
      "Detects zero relations",
    );
  }

  // Test 13: Stats are correct
  {
    const { validation } = await validationAgent({
      input,
      worldModel: makeModel(),
    });
    assert(validation.stats.entities === 2, "Stats: correct entity count");
    assert(validation.stats.relations === 1, "Stats: correct relation count");
    assert(validation.stats.processes === 1, "Stats: correct process count");
    assert(
      validation.stats.constraints === 1,
      "Stats: correct constraint count",
    );
  }

  // Test 14: Circular dependency detection
  {
    const model = makeModel({
      relations: [
        {
          id: "rel_1",
          type: "depends_on",
          source: "ent_1",
          target: "ent_2",
          label: "a→b",
        },
        {
          id: "rel_2",
          type: "depends_on",
          source: "ent_2",
          target: "ent_1",
          label: "b→a",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "CIRCULAR_DEPENDENCY"),
      "Detects circular dependency (A→B→A)",
    );
  }

  // Test 15: No false positive on non-dependency cycles (uses is fine)
  {
    const model = makeModel({
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "a uses b",
        },
        {
          id: "rel_2",
          type: "uses",
          source: "ent_2",
          target: "ent_1",
          label: "b uses a",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      !hasIssue(validation.issues, "CIRCULAR_DEPENDENCY"),
      "No false positive: mutual 'uses' is not a circular dependency",
    );
  }

  // Test 16: Duplicate step order
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Flow",
          description: "test",
          steps: [
            { order: 1, action: "a" },
            { order: 1, action: "b" },
            { order: 2, action: "c" },
          ],
          participants: ["ent_1"],
          outcomes: ["done"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "DUPLICATE_STEP_ORDER"),
      "Detects duplicate step order numbers",
    );
  }

  // Test 17: Unordered steps
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Flow",
          description: "test",
          steps: [
            { order: 3, action: "a" },
            { order: 1, action: "b" },
            { order: 2, action: "c" },
          ],
          participants: ["ent_1"],
          outcomes: ["done"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "UNORDERED_STEPS"),
      "Detects out-of-order steps",
    );
  }

  // Test 18: Correctly ordered steps — no false positive
  {
    const model = makeModel({
      processes: [
        {
          id: "proc_1",
          name: "Flow",
          description: "test",
          steps: [
            { order: 1, action: "a" },
            { order: 2, action: "b" },
            { order: 3, action: "c" },
          ],
          participants: ["ent_1"],
          outcomes: ["done"],
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      !hasIssue(validation.issues, "UNORDERED_STEPS"),
      "No false positive on correctly ordered steps",
    );
    assert(
      !hasIssue(validation.issues, "DUPLICATE_STEP_ORDER"),
      "No false positive on unique step orders",
    );
  }

  // Test 19: Weak description
  {
    const model = makeModel({
      entities: [
        { id: "ent_1", name: "User", type: "actor", description: "" },
        { id: "ent_2", name: "DB", type: "system", description: "hi" },
      ],
      relations: [
        {
          id: "rel_1",
          type: "uses",
          source: "ent_1",
          target: "ent_2",
          label: "x",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "WEAK_DESCRIPTION"),
      "Detects weak/empty descriptions",
    );
    const weakCount = validation.issues.filter(
      (i) => i.code === "WEAK_DESCRIPTION",
    ).length;
    assert(
      weakCount === 2,
      "Flags both empty and trivially short descriptions",
    );
  }

  // Test 20: Good descriptions — no false positive
  {
    const { validation } = await validationAgent({
      input,
      worldModel: makeModel(),
    });
    assert(
      !hasIssue(validation.issues, "WEAK_DESCRIPTION"),
      "No false positive on adequate descriptions",
    );
  }

  // Test 21: Low type diversity
  {
    const model = makeModel({
      entities: [
        { id: "e1", name: "A", type: "object", description: "Object A" },
        { id: "e2", name: "B", type: "object", description: "Object B" },
        { id: "e3", name: "C", type: "object", description: "Object C" },
        { id: "e4", name: "D", type: "object", description: "Object D" },
        { id: "e5", name: "E", type: "object", description: "Object E" },
      ],
      relations: [
        { id: "r1", type: "uses", source: "e1", target: "e2", label: "x" },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "LOW_TYPE_DIVERSITY"),
      "Detects low type diversity (100% object)",
    );
  }

  // Test 22: Good type diversity — no false positive
  {
    const model = makeModel({
      entities: [
        { id: "e1", name: "User", type: "actor", description: "A user" },
        { id: "e2", name: "API", type: "system", description: "API server" },
        { id: "e3", name: "DB", type: "system", description: "Database" },
        {
          id: "e4",
          name: "Auth",
          type: "concept",
          description: "Authentication",
        },
        { id: "e5", name: "Token", type: "object", description: "Auth token" },
      ],
      relations: [
        { id: "r1", type: "uses", source: "e1", target: "e2", label: "x" },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      !hasIssue(validation.issues, "LOW_TYPE_DIVERSITY"),
      "No false positive on diverse types",
    );
  }

  // Test 23: Score — clean model gets high score
  {
    const { validation } = await validationAgent({
      input,
      worldModel: makeModel(),
    });
    assert(validation.score !== undefined, "Score: present on result");
    assert(validation.score! >= 80, "Score: clean model >= 80");
  }

  // Test 24: Score — empty model gets low score
  {
    const model = makeModel({
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(validation.score! <= 50, "Score: empty model <= 50");
  }

  // Test 25: Score — many errors reduce score
  {
    const model = makeModel({
      relations: [
        {
          id: "r1",
          type: "uses",
          source: "ent_bad1",
          target: "ent_bad2",
          label: "x",
        },
        {
          id: "r2",
          type: "uses",
          source: "ent_bad3",
          target: "ent_bad4",
          label: "y",
        },
      ],
    });
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      validation.score! < 70,
      "Score: dangling errors reduce score significantly",
    );
  }

  // Test 26: Score — clamped to 0-100
  {
    const { validation } = await validationAgent({
      input,
      worldModel: makeModel(),
    });
    assert(
      validation.score! >= 0 && validation.score! <= 100,
      "Score: within 0-100 range",
    );
  }

  // Test 27: Low confidence warning
  {
    const model = makeModel();
    model.metadata = {
      source_type: "text",
      source_summary: "test",
      confidence: 0.2,
    };
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "LOW_CONFIDENCE"),
      "Detects low confidence (20%)",
    );
  }

  // Test 28: Normal confidence — no false positive
  {
    const model = makeModel();
    model.metadata = {
      source_type: "text",
      source_summary: "test",
      confidence: 0.8,
    };
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      !hasIssue(validation.issues, "LOW_CONFIDENCE"),
      "No false positive on 80% confidence",
    );
  }

  // Test 29: Missing metadata warning
  {
    const model = makeModel();
    delete (model as Record<string, unknown>).metadata;
    const { validation } = await validationAgent({ input, worldModel: model });
    assert(
      hasIssue(validation.issues, "MISSING_METADATA"),
      "Detects missing metadata",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
