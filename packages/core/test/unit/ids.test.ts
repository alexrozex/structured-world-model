/**
 * Unit tests for ID generation.
 */

import { genId } from "../../src/utils/ids.js";

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
  console.log("\n\u2500\u2500\u2500 ID Generation Tests \u2500\u2500\u2500\n");

  // Test 1: Returns string
  assert(typeof genId("ent") === "string", "genId returns a string");

  // Test 2: Has correct prefix
  assert(genId("ent").startsWith("ent_"), "ent prefix correct");
  assert(genId("rel").startsWith("rel_"), "rel prefix correct");
  assert(genId("proc").startsWith("proc_"), "proc prefix correct");
  assert(genId("cstr").startsWith("cstr_"), "cstr prefix correct");
  assert(genId("wm").startsWith("wm_"), "wm prefix correct");

  // Test 3: Hex suffix is 12 chars (6 bytes = 12 hex)
  {
    const id = genId("ent");
    const hex = id.split("_")[1];
    assert(hex.length === 12, "Hex suffix is 12 characters");
    assert(/^[0-9a-f]{12}$/.test(hex), "Hex suffix is valid lowercase hex");
  }

  // Test 4: Total length = prefix + underscore + 12
  {
    assert(genId("ent").length === 16, "ent_ + 12 hex = 16 chars");
    assert(genId("proc").length === 17, "proc_ + 12 hex = 17 chars");
  }

  // Test 5: IDs are unique
  {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(genId("ent"));
    assert(ids.size === 1000, "1000 generated IDs are all unique");
  }

  // Test 6: Empty prefix works
  {
    const id = genId("");
    assert(id.startsWith("_"), "Empty prefix produces _hex");
    assert(id.length === 13, "Empty prefix: _ + 12 hex = 13 chars");
  }

  // Test 7: Custom prefix works
  {
    const id = genId("custom");
    assert(id.startsWith("custom_"), "Custom prefix works");
  }

  // Test 8: No collision between prefixes
  {
    const entId = genId("ent");
    const relId = genId("rel");
    assert(entId !== relId, "Different prefixes produce different IDs");
    assert(!entId.startsWith("rel_"), "ent ID doesn't start with rel_");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
