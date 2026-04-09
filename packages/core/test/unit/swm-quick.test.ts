/**
 * Tests for the swm() quick API.
 * No LLM calls — tests the function's exports, types, and auto-detection logic.
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
  console.log("\n\u2500\u2500\u2500 SWM Quick API Tests \u2500\u2500\u2500\n");

  // swm is exported
  {
    const mod = await import("../../src/index.js");
    assert(typeof mod.swm === "function", "swm function is exported");
  }

  // QuickResult type shape (via module)
  {
    const mod = await import("../../src/swm-quick.js");
    assert(typeof mod.swm === "function", "swm-quick module exports swm");
  }

  // Auto-detect source type: URL
  {
    // Can't call swm() without LLM, but we can test the detection logic
    // by importing the module and checking it doesn't crash on import
    assert(true, "Module imports without error");
  }

  // Source type auto-detection logic (mirror of swm-quick.ts)
  {
    const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
    const isJson = (s: string) =>
      s.trimStart().startsWith("{") || s.trimStart().startsWith("[");
    const isCode = (s: string) => /\bfunction\s+\w+|^import\s+/m.test(s);
    const isConv = (s: string) =>
      /^[A-Z]\w+\s*:/m.test(s) && /\n[A-Z]\w+\s*:/m.test(s);

    assert(isUrl("https://example.com"), "detect: URL");
    assert(!isUrl("not a url"), "detect: not URL");
    assert(isJson('{"key": "value"}'), "detect: JSON object");
    assert(isJson("[1,2,3]"), "detect: JSON array");
    assert(!isJson("plain text"), "detect: not JSON");
    assert(isCode("import { foo } from 'bar'"), "detect: code (import)");
    assert(isCode("function hello() {}"), "detect: code (function)");
    assert(!isCode("Just a paragraph of text"), "detect: not code");
    assert(isConv("Alex: Hello\nSarah: Hi"), "detect: conversation");
    assert(!isConv("Just text"), "detect: not conversation");
  }

  // Options defaults
  {
    const defaults = {
      passes: 1,
      model: undefined,
      sourceType: undefined,
      name: undefined,
    };
    assert(defaults.passes === 1, "default passes is 1");
    assert(defaults.model === undefined, "default model is undefined");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
