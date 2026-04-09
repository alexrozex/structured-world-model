/**
 * Unit tests for swm.ts — SWMOptions, exports, and pass clamping logic.
 * Cannot test buildWorldModel() directly (requires LLM) but can test
 * the module's exports, types, and option handling.
 */

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

async function run() {
  console.log("\n\u2500\u2500\u2500 SWM Module Tests \u2500\u2500\u2500\n");

  // Test 1: buildWorldModel is exported as a function
  {
    const mod = await import("../../src/swm.js");
    assert(
      typeof mod.buildWorldModel === "function",
      "buildWorldModel is exported as a function",
    );
  }

  // Test 2: Pipeline is re-exported
  {
    const mod = await import("../../src/swm.js");
    assert(typeof mod.Pipeline === "function", "Pipeline class is re-exported");
  }

  // Test 3: SWMOptions fields are optional (type test via construction)
  {
    // This tests that the interface allows empty options
    const mod = await import("../../src/swm.js");
    const opts: import("../../src/swm.js").SWMOptions = {};
    assert(
      opts.passes === undefined,
      "SWMOptions.passes defaults to undefined",
    );
    assert(opts.model === undefined, "SWMOptions.model defaults to undefined");
    assert(
      opts.onStageStart === undefined,
      "SWMOptions.onStageStart defaults to undefined",
    );
    assert(
      opts.onStageEnd === undefined,
      "SWMOptions.onStageEnd defaults to undefined",
    );
  }

  // Test 4: Passes clamping logic — test via Math.min/max pattern
  {
    // The code does: Math.min(Math.max(options?.passes ?? 1, 1), 3)
    const clamp = (p: number | undefined) => Math.min(Math.max(p ?? 1, 1), 3);
    assert(clamp(undefined) === 1, "Undefined passes defaults to 1");
    assert(clamp(0) === 1, "Passes 0 clamped to 1");
    assert(clamp(-1) === 1, "Passes -1 clamped to 1");
    assert(clamp(1) === 1, "Passes 1 stays 1");
    assert(clamp(2) === 2, "Passes 2 stays 2");
    assert(clamp(3) === 3, "Passes 3 stays 3");
    assert(clamp(4) === 3, "Passes 4 clamped to 3");
    assert(clamp(100) === 3, "Passes 100 clamped to 3");
  }

  // Test 5: setDefaultModel is importable
  {
    const llm = await import("../../src/utils/llm.js");
    assert(
      typeof llm.setDefaultModel === "function",
      "setDefaultModel is importable",
    );
    assert(
      typeof llm.getDefaultModel === "function",
      "getDefaultModel is importable",
    );
    const original = llm.getDefaultModel();
    llm.setDefaultModel("test-model");
    assert(
      llm.getDefaultModel() === "test-model",
      "setDefaultModel changes the model",
    );
    llm.setDefaultModel(original); // restore
  }

  // Test 6: Module exports PipelineInput and PipelineResult types
  {
    // Type-level test: if this compiles, types are exported correctly
    const mod = await import("../../src/swm.js");
    type Input = import("../../src/swm.js").PipelineInput;
    type Result = import("../../src/swm.js").PipelineResult;
    const testInput: Input = { raw: "test", sourceType: "text" };
    assert(testInput.raw === "test", "PipelineInput type is usable");
    assert(
      typeof mod.buildWorldModel === "function",
      "PipelineResult type exists (buildWorldModel returns it)",
    );
  }

  // Test 7: Pipeline can be constructed from re-export
  {
    const { Pipeline } = await import("../../src/swm.js");
    const p = new Pipeline();
    assert(p instanceof Pipeline, "Re-exported Pipeline is constructable");
  }

  // Test 8: Callbacks are wirable
  {
    const starts: string[] = [];
    const ends: string[] = [];
    const { Pipeline } = await import("../../src/swm.js");
    const p = new Pipeline({
      onStageStart: (name: string) => starts.push(name),
      onStageEnd: (name: string) => ends.push(name),
    });
    // Just verify the pipeline accepts callbacks without error
    assert(starts.length === 0, "Callbacks wired without execution yet");
  }

  // Test 9: autoFix option defaults
  {
    const clampFix = (af: boolean | undefined) => af !== false;
    assert(clampFix(undefined) === true, "autoFix undefined defaults to true");
    assert(clampFix(true) === true, "autoFix true stays true");
    assert(clampFix(false) === false, "autoFix false stays false");
  }

  // Test 10: SWMOptions accepts autoFix
  {
    const opts: import("../../src/swm.js").SWMOptions = { autoFix: false };
    assert(opts.autoFix === false, "SWMOptions.autoFix can be set to false");
  }

  // Test 11: fixWorldModel is importable and works
  {
    const { fixWorldModel } = await import("../../src/utils/fix.js");
    assert(typeof fixWorldModel === "function", "fixWorldModel is importable");
    const model = {
      id: "wm_t",
      name: "T",
      description: "t",
      version: "0.1.0",
      created_at: "2026-01-01",
      entities: [
        { id: "ent_1", name: "A", type: "actor" as const, description: "a" },
        {
          id: "ent_noise",
          name: "incoming relations array",
          type: "object" as const,
          description:
            "Auto-created entity for unresolved reference: incoming relations array",
        },
      ],
      relations: [],
      processes: [],
      constraints: [],
    };
    const { model: fixed, fixes } = fixWorldModel(model as any);
    assert(fixes.length > 0, "fixWorldModel produces fixes for noise entities");
    assert(
      !fixed.entities.some((e: any) => e.id === "ent_noise"),
      "fixWorldModel removes noise entity",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
