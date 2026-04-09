import { getPromptForSourceType, PROMPTS } from "../../src/agents/prompts.js";

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
  console.log("═══ Prompts Unit Tests ═══\n");

  // All source types have prompts
  const types = ["text", "code", "conversation", "document", "url", "mixed"];
  for (const t of types) {
    assert(PROMPTS[t] !== undefined, `PROMPTS: has ${t} prompt`);
    assert(PROMPTS[t].length > 100, `PROMPTS: ${t} prompt is substantial`);
    assert(PROMPTS[t].includes("entities"), `PROMPTS: ${t} mentions entities`);
  }

  // getPromptForSourceType returns correct prompts
  for (const t of types) {
    assert(
      getPromptForSourceType(t) === PROMPTS[t],
      `getPrompt: ${t} returns correct prompt`,
    );
  }

  // Unknown type falls back to text
  assert(
    getPromptForSourceType("unknown") === PROMPTS.text,
    "getPrompt: unknown → text fallback",
  );
  assert(
    getPromptForSourceType("") === PROMPTS.text,
    "getPrompt: empty → text fallback",
  );

  // Code prompt has import chain instructions
  assert(
    PROMPTS.code.includes("import chain"),
    "code prompt: has import chain instruction",
  );

  // Code prompt has TypeScript few-shot example
  assert(
    PROMPTS.code.includes("TypeScript with imports"),
    "code prompt: has TypeScript few-shot example",
  );
  assert(
    PROMPTS.code.includes("User Service"),
    "code prompt: TypeScript example extracts module boundary as entity",
  );
  assert(
    PROMPTS.code.includes("Auth Middleware"),
    "code prompt: TypeScript example extracts middleware as system entity",
  );
  assert(
    PROMPTS.code.includes("calls db.insert"),
    "code prompt: TypeScript example shows imports as relations",
  );

  // Code prompt has Python few-shot example
  assert(
    PROMPTS.code.includes("Python codebase"),
    "code prompt: has Python few-shot example",
  );
  assert(
    PROMPTS.code.includes("Fetch Module"),
    "code prompt: Python example extracts module boundary as entity",
  );
  assert(
    PROMPTS.code.includes("CLI Entry Point"),
    "code prompt: Python example extracts CLI entry point as actor",
  );
  assert(
    PROMPTS.code.includes("URL Ingestion Pipeline"),
    "code prompt: Python example shows exported function as process",
  );
  assert(
    PROMPTS.code.includes("imports fetch_url"),
    "code prompt: Python example shows imports as uses relations",
  );

  // Document prompt has JSON/YAML awareness
  assert(PROMPTS.document.includes("JSON"), "document prompt: mentions JSON");
  assert(PROMPTS.document.includes("YAML"), "document prompt: mentions YAML");

  // Text prompt has few-shot example
  assert(PROMPTS.text.includes("Library"), "text prompt: has few-shot example");

  // All prompts have the base schema
  for (const t of types) {
    assert(
      PROMPTS[t].includes("Output ONLY valid JSON"),
      "PROMPTS: ${t} includes base schema",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
