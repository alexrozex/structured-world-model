/**
 * Unit tests for Pipeline class.
 */

import { Pipeline } from "../../src/pipeline/pipeline.js";
import type { PipelineInput } from "../../src/pipeline/pipeline.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function run() {
  console.log("\n─── Pipeline Tests ───\n");

  // Helper: create a mock final stage output that matches PipelineResult shape
  const mockWorldModel = {
    id: "wm_test",
    name: "Test",
    description: "Test model",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: [],
    relations: [],
    processes: [],
    constraints: [],
  };
  const mockValidation = {
    valid: true,
    issues: [],
    stats: { entities: 0, relations: 0, processes: 0, constraints: 0 },
    score: 100,
  };

  // Test 1: Pipeline is constructable
  {
    const p = new Pipeline();
    assert(p instanceof Pipeline, "Pipeline is constructable");
  }

  // Test 2: addStage returns Pipeline for chaining
  {
    const p = new Pipeline();
    const result = p.addStage("test", async (x) => x);
    assert(result === p, "addStage returns Pipeline for chaining");
  }

  // Test 3: Single stage executes
  {
    const p = new Pipeline();
    p.addStage("only", async (_input: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    const input: PipelineInput = { raw: "hello", sourceType: "text" };
    const result = await p.execute(input);
    assert(
      result.worldModel.id === "wm_test",
      "Single stage executes and returns worldModel",
    );
  }

  // Test 4: Multiple stages execute in order
  {
    const order: string[] = [];
    const p = new Pipeline();
    p.addStage("first", async (input: unknown) => {
      order.push("first");
      return input;
    });
    p.addStage("second", async (input: unknown) => {
      order.push("second");
      return input;
    });
    p.addStage("third", async (_input: unknown) => {
      order.push("third");
      return { worldModel: mockWorldModel, validation: mockValidation };
    });
    await p.execute({ raw: "test", sourceType: "text" });
    assert(
      order[0] === "first" && order[1] === "second" && order[2] === "third",
      "Multiple stages execute in order",
    );
  }

  // Test 5: Stage output is passed as input to next stage
  {
    const p = new Pipeline();
    p.addStage("double", async (input: unknown) => {
      const i = input as PipelineInput;
      return { ...i, raw: i.raw + i.raw };
    });
    p.addStage("finish", async (input: unknown) => {
      const i = input as PipelineInput;
      return {
        worldModel: { ...mockWorldModel, name: i.raw },
        validation: mockValidation,
      };
    });
    const result = await p.execute({ raw: "ab", sourceType: "text" });
    assert(
      result.worldModel.name === "abab",
      "Stage output passes as input to next stage",
    );
  }

  // Test 6: stages array in result has correct length
  {
    const p = new Pipeline();
    p.addStage("a", async (x: unknown) => x);
    p.addStage("b", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    const result = await p.execute({ raw: "", sourceType: "text" });
    assert(
      result.stages.length === 2,
      "Result stages array has correct length",
    );
  }

  // Test 7: Stage names are recorded
  {
    const p = new Pipeline();
    p.addStage("extraction", async (x: unknown) => x);
    p.addStage("validation", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    const result = await p.execute({ raw: "", sourceType: "text" });
    assert(
      result.stages[0].stage === "extraction",
      "First stage name recorded",
    );
    assert(
      result.stages[1].stage === "validation",
      "Second stage name recorded",
    );
  }

  // Test 8: Duration is tracked
  {
    const p = new Pipeline();
    p.addStage("slow", async (x: unknown) => {
      await new Promise((r) => setTimeout(r, 10));
      return x;
    });
    p.addStage("finish", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    const result = await p.execute({ raw: "", sourceType: "text" });
    assert(
      result.stages[0].durationMs >= 9,
      "Stage duration is tracked (>= 9ms)",
    );
    assert(result.totalDurationMs >= 9, "Total duration is tracked");
  }

  // Test 9: onStageStart callback fires
  {
    const started: string[] = [];
    const p = new Pipeline({ onStageStart: (name) => started.push(name) });
    p.addStage("a", async (x: unknown) => x);
    p.addStage("b", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    await p.execute({ raw: "", sourceType: "text" });
    assert(started.length === 2, "onStageStart fires for each stage");
    assert(
      started[0] === "a" && started[1] === "b",
      "onStageStart receives stage names",
    );
  }

  // Test 10: onStageEnd callback fires with duration
  {
    const ended: Array<{ name: string; ms: number }> = [];
    const p = new Pipeline({
      onStageEnd: (name, ms) => ended.push({ name, ms }),
    });
    p.addStage("x", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    await p.execute({ raw: "", sourceType: "text" });
    assert(ended.length === 1, "onStageEnd fires");
    assert(ended[0].name === "x", "onStageEnd receives stage name");
    assert(typeof ended[0].ms === "number", "onStageEnd receives duration");
  }

  // Test 11: Empty pipeline returns undefined worldModel
  {
    const p = new Pipeline();
    const result = await p.execute({ raw: "", sourceType: "text" });
    assert(
      result.worldModel === undefined,
      "Empty pipeline returns undefined worldModel",
    );
    assert(result.stages.length === 0, "Empty pipeline has no stages");
  }

  // Test 12: Stage data is captured in results
  {
    const p = new Pipeline();
    p.addStage("produce", async (_x: unknown) => ({ value: 42 }));
    p.addStage("finish", async (_x: unknown) => ({
      worldModel: mockWorldModel,
      validation: mockValidation,
    }));
    const result = await p.execute({ raw: "", sourceType: "text" });
    const firstData = result.stages[0].data as { value: number };
    assert(firstData.value === 42, "Stage data is captured in results");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
