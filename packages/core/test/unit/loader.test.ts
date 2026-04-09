/**
 * Tests for model loading and validation utilities.
 */

import {
  parseWorldModel,
  validateWorldModel,
  loadWorldModelFromFile,
} from "../../src/utils/loader.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const validModel = {
  id: "wm_test",
  name: "Test",
  description: "A test model",
  version: "0.1.0",
  created_at: "2026-01-01T00:00:00Z",
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
  processes: [],
  constraints: [],
};

async function run() {
  console.log("\n\u2500\u2500\u2500 Loader Tests \u2500\u2500\u2500\n");

  // parseWorldModel — valid JSON
  {
    const { model, warnings } = parseWorldModel(JSON.stringify(validModel));
    assert(model.name === "Test", "parseWorldModel: parses valid model");
    assert(model.entities.length === 2, "parseWorldModel: entities preserved");
    assert(
      warnings.length === 0 || warnings.every((w) => w.includes("metadata")),
      "parseWorldModel: no critical warnings on valid model",
    );
  }

  // parseWorldModel — invalid JSON
  {
    try {
      parseWorldModel("not json {{{");
      assert(false, "parseWorldModel: should throw on invalid JSON");
    } catch (e: any) {
      assert(
        e.message.includes("Invalid JSON"),
        "parseWorldModel: throws descriptive error on invalid JSON",
      );
    }
  }

  // parseWorldModel — valid JSON but not a world model
  {
    try {
      parseWorldModel('{"foo": "bar"}');
      assert(false, "parseWorldModel: should throw on non-model JSON");
    } catch (e: any) {
      assert(
        e.message.includes("Invalid world model"),
        "parseWorldModel: throws on non-model JSON",
      );
    }
  }

  // validateWorldModel — valid object
  {
    const { model } = validateWorldModel(validModel);
    assert(model.id === "wm_test", "validateWorldModel: accepts valid object");
  }

  // validateWorldModel — empty entities warning
  {
    const emptyModel = { ...validModel, entities: [], relations: [] };
    const { warnings } = validateWorldModel(emptyModel);
    assert(
      warnings.some((w) => w.includes("no entities")),
      "validateWorldModel: warns on empty entities",
    );
  }

  // validateWorldModel — no relations warning
  {
    const noRels = { ...validModel, relations: [] };
    const { warnings } = validateWorldModel(noRels);
    assert(
      warnings.some((w) => w.includes("no relations")),
      "validateWorldModel: warns on missing relations",
    );
  }

  // validateWorldModel — no metadata warning
  {
    const noMeta = { ...validModel };
    delete (noMeta as any).metadata;
    const { warnings } = validateWorldModel(noMeta);
    assert(
      warnings.some((w) => w.includes("metadata")),
      "validateWorldModel: warns on missing metadata",
    );
  }

  // validateWorldModel — invalid data throws
  {
    try {
      validateWorldModel({ entities: "not an array" });
      assert(false, "validateWorldModel: should throw on invalid data");
    } catch (e: any) {
      assert(
        e.message.includes("Invalid world model"),
        "validateWorldModel: throws with path info",
      );
    }
  }

  // loadWorldModelFromFile — valid file
  {
    const tmpFile = resolve(import.meta.dirname!, "../../.test-loader.json");
    writeFileSync(tmpFile, JSON.stringify(validModel));
    try {
      const { model } = loadWorldModelFromFile(tmpFile);
      assert(model.name === "Test", "loadWorldModelFromFile: loads valid file");
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  }

  // loadWorldModelFromFile — nonexistent file
  {
    try {
      loadWorldModelFromFile("/nonexistent/path.json");
      assert(false, "loadWorldModelFromFile: should throw on missing file");
    } catch (e: any) {
      assert(
        e.message.includes("Cannot read file"),
        "loadWorldModelFromFile: descriptive error on missing file",
      );
    }
  }

  // loadWorldModelFromFile — invalid JSON file
  {
    const tmpFile = resolve(
      import.meta.dirname!,
      "../../.test-loader-bad.json",
    );
    writeFileSync(tmpFile, "not valid json");
    try {
      loadWorldModelFromFile(tmpFile);
      assert(false, "loadWorldModelFromFile: should throw on bad JSON");
    } catch (e: any) {
      assert(
        e.message.includes("Invalid JSON"),
        "loadWorldModelFromFile: descriptive error on bad JSON",
      );
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  }

  // parseWorldModel — preserves source_context
  {
    const modelWithCtx = {
      ...validModel,
      entities: [
        {
          ...validModel.entities[0],
          source_context: "Users register on the platform",
        },
        validModel.entities[1],
      ],
    };
    const { model } = parseWorldModel(JSON.stringify(modelWithCtx));
    assert(
      model.entities[0].source_context === "Users register on the platform",
      "parseWorldModel: preserves source_context",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
