/**
 * Tests for model serialization utilities.
 */

import {
  toCompactJSON,
  toPrettyJSON,
  toYAML,
  modelSize,
} from "../../src/utils/serialize.js";
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

const model: WorldModelType = {
  id: "wm_test",
  name: "Test",
  description: "A test model",
  version: "0.1.0",
  created_at: "2026-01-01",
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
      description: "User login",
      steps: [{ order: 1, action: "Enter creds", actor: "ent_1" }],
      participants: ["ent_1"],
      outcomes: ["Authenticated"],
    },
  ],
  constraints: [
    {
      id: "cstr_1",
      name: "Auth",
      type: "authorization",
      description: "Must auth",
      scope: ["ent_1"],
      severity: "hard",
    },
  ],
} as WorldModelType;

function run() {
  console.log("\n\u2500\u2500\u2500 Serialize Tests \u2500\u2500\u2500\n");

  // toCompactJSON
  {
    const json = toCompactJSON(model);
    assert(!json.includes("\n"), "compact: no newlines");
    assert(!json.includes("  "), "compact: no indentation");
    const parsed = JSON.parse(json);
    assert(parsed.name === "Test", "compact: round-trips correctly");
  }

  // toPrettyJSON
  {
    const json = toPrettyJSON(model);
    assert(json.includes("\n"), "pretty: has newlines");
    assert(json.includes("  "), "pretty: has indentation");
    const parsed = JSON.parse(json);
    assert(parsed.entities.length === 2, "pretty: round-trips correctly");
  }

  // toYAML
  {
    const yaml = toYAML(model);
    assert(yaml.includes("name: Test"), "yaml: has name field");
    assert(yaml.includes("entities:"), "yaml: has entities section");
    assert(yaml.includes("User"), "yaml: has entity name");
    assert(!yaml.startsWith("{"), "yaml: not JSON");
  }

  // modelSize
  {
    const size = modelSize(model);
    assert(size.entities === 2, "size: 2 entities");
    assert(size.relations === 1, "size: 1 relation");
    assert(size.processes === 1, "size: 1 process");
    assert(size.constraints === 1, "size: 1 constraint");
    assert(size.totalElements === 5, "size: 5 total elements");
    assert(size.jsonBytes > 0, "size: positive byte count");
    assert(typeof size.jsonBytes === "number", "size: jsonBytes is number");
  }

  // Compact is smaller than pretty
  {
    const compact = toCompactJSON(model);
    const pretty = toPrettyJSON(model);
    assert(compact.length < pretty.length, "compact is smaller than pretty");
  }

  // Empty model
  {
    const empty = {
      ...model,
      entities: [],
      relations: [],
      processes: [],
      constraints: [],
    } as WorldModelType;
    const size = modelSize(empty);
    assert(size.totalElements === 0, "empty: zero total elements");
    assert(size.jsonBytes > 0, "empty: still has JSON overhead");
    const yaml = toYAML(empty);
    assert(yaml.includes("entities:"), "empty yaml: has entities key");
    const json = toCompactJSON(empty);
    assert(json.includes('"entities":[]'), "empty compact: empty arrays");
  }

  // Large model size scales
  {
    const big = {
      ...model,
      entities: Array.from({ length: 100 }, (_, i) => ({
        id: `ent_${i}`,
        name: `E${i}`,
        type: "object" as const,
        description: `Entity ${i}`,
      })),
    } as WorldModelType;
    const size = modelSize(big);
    assert(size.entities === 100, "big: 100 entities counted");
    assert(size.jsonBytes > 1000, "big: substantial byte count");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
