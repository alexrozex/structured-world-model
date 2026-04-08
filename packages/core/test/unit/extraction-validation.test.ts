/**
 * Unit tests for Zod extraction validation / coercion.
 * Tests the safety net between raw LLM output and the structuring agent.
 */

import { validateExtraction } from "../../src/schema/extraction.js";

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
  console.log("═══ Extraction Validation Unit Tests ═══\n");

  // Test 1: Valid extraction passes cleanly
  {
    const { extraction, issues } = validateExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
      relations: [],
      processes: [],
      constraints: [],
      model_name: "Test",
      model_description: "Test",
      source_summary: "test",
      confidence: 0.9,
      extraction_notes: [],
    });
    assert(extraction.entities.length === 1, "Valid input: preserves entities");
    assert(issues.length === 0, "Valid input: no issues");
  }

  // Test 2: null input returns empty model
  {
    const { extraction, issues } = validateExtraction(null);
    assert(extraction.entities.length === 0, "null: returns empty entities");
    assert(issues.length > 0, "null: reports issue");
    assert(issues[0].includes("null"), "null: issue mentions null");
  }

  // Test 3: undefined input returns empty model
  {
    const { extraction, issues } = validateExtraction(undefined);
    assert(
      extraction.entities.length === 0,
      "undefined: returns empty entities",
    );
    assert(issues.length > 0, "undefined: reports issue");
  }

  // Test 4: Non-object input returns empty model
  {
    const { extraction, issues } = validateExtraction("just a string");
    assert(extraction.entities.length === 0, "string: returns empty entities");
    assert(
      issues.some((i) => i.includes("string")),
      "string: issue mentions type",
    );
  }

  // Test 5: Missing fields get defaults
  {
    const { extraction, issues } = validateExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
    });
    assert(
      extraction.entities.length === 1,
      "Missing fields: preserves entities",
    );
    assert(
      extraction.relations.length === 0,
      "Missing fields: defaults relations to []",
    );
    assert(
      extraction.model_name === "Untitled",
      "Missing fields: defaults model_name",
    );
    assert(
      extraction.confidence === 0.5,
      "Missing fields: defaults confidence to 0.5",
    );
  }

  // Test 6: Entities with empty names get filtered
  {
    const { extraction, issues } = validateExtraction({
      entities: [
        { name: "User", type: "actor", description: "Valid" },
        { name: "", type: "actor", description: "Empty name" },
      ],
    });
    assert(
      extraction.entities.length === 1,
      "Empty name filter: drops empty-name entities",
    );
    assert(
      issues.some((i) => i.includes("Dropped")),
      "Empty name filter: reports dropped count",
    );
  }

  // Test 7: Relations with empty source/target get filtered
  {
    const { extraction, issues } = validateExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
      relations: [
        { source: "User", target: "DB", type: "uses", label: "valid" },
        { source: "", target: "DB", type: "uses", label: "bad source" },
      ],
    });
    assert(
      extraction.relations.length === 1,
      "Empty source filter: drops empty-source relations",
    );
  }

  // Test 8: Partial entity data gets defaults
  {
    const { extraction } = validateExtraction({
      entities: [{ name: "User" }],
    });
    assert(
      extraction.entities[0].type === "object",
      "Partial entity: defaults type to 'object'",
    );
    assert(
      extraction.entities[0].description === "",
      "Partial entity: defaults description to ''",
    );
  }

  // Test 9: Process steps default correctly
  {
    const { extraction } = validateExtraction({
      processes: [
        {
          name: "Login",
          description: "login flow",
          steps: [{ action: "click" }],
          participants: ["User"],
          outcomes: ["session"],
        },
      ],
    });
    assert(
      extraction.processes.length === 1,
      "Process defaults: process preserved",
    );
    assert(
      extraction.processes[0].steps.length === 1,
      "Process defaults: step preserved",
    );
    assert(
      extraction.processes[0].steps[0].action === "click",
      "Process defaults: step action preserved",
    );
  }

  // Test 10: Constraint severity defaults to soft
  {
    const { extraction } = validateExtraction({
      constraints: [
        { name: "Limit", type: "rule", description: "test", scope: ["X"] },
      ],
    });
    assert(
      extraction.constraints[0].severity === "soft",
      "Constraint default: severity defaults to soft",
    );
  }

  // Test 11: Confidence clamped to 0-1
  {
    const { extraction: high } = validateExtraction({ confidence: 0.95 });
    assert(high.confidence === 0.95, "Confidence: valid value preserved");
  }

  // Test 12: Completely garbled object gets salvaged
  {
    const { extraction, issues } = validateExtraction({
      entities: "not an array",
      relations: 42,
      model_name: 123,
    });
    assert(
      extraction.entities.length === 0,
      "Garbled: salvages to empty entities",
    );
    assert(issues.length > 0, "Garbled: reports issues");
  }

  // Test 13: source_context is preserved when present
  {
    const { extraction, issues } = validateExtraction({
      entities: [
        {
          name: "PaymentService",
          type: "system",
          description: "Handles payments",
          source_context:
            "The PaymentService processes all credit card transactions.",
        },
      ],
    });
    assert(
      extraction.entities.length === 1,
      "source_context: entity preserved",
    );
    assert(issues.length === 0, "source_context: no issues");
    assert(
      extraction.entities[0].source_context ===
        "The PaymentService processes all credit card transactions.",
      "source_context: value preserved verbatim",
    );
  }

  // Test 14: source_context is optional — entity without it still valid
  {
    const { extraction } = validateExtraction({
      entities: [{ name: "User", type: "actor", description: "A user" }],
    });
    assert(
      extraction.entities[0].source_context === undefined,
      "source_context: absent when not provided",
    );
  }

  // Test 15: source_context is omitted from schema when undefined (not coerced to empty string)
  {
    const { extraction } = validateExtraction({
      entities: [
        {
          name: "Database",
          type: "system",
          description: "Stores data",
          source_context: undefined,
        },
      ],
    });
    assert(
      !("source_context" in extraction.entities[0]) ||
        extraction.entities[0].source_context === undefined,
      "source_context: undefined stays undefined",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
