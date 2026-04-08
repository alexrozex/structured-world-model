/**
 * Tests for source type detection logic.
 * We import detectSourceType indirectly by re-implementing the same logic here
 * since it's a private CLI function. These tests validate the heuristics.
 */

// Re-implement the detection logic for testing (mirrors src/cli.ts detectSourceType)
function detectSourceType(raw: string, filePath?: string): string {
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const codeExts = new Set([
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "cs",
      "swift",
      "kt",
    ]);
    if (codeExts.has(ext ?? "")) return "code";
    if (
      ext === "json" ||
      ext === "yaml" ||
      ext === "yml" ||
      ext === "xml" ||
      ext === "csv" ||
      ext === "toml"
    )
      return "document";
    if (ext === "md" || ext === "txt" || ext === "rst") return "text";
  }
  const trimmed = raw.trimStart();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(raw);
      return "document";
    } catch {
      /* */
    }
  }
  const yamlLines = raw.split("\n").filter((l) => /^\w[\w\s]*:\s/.test(l));
  if (yamlLines.length >= 3 && !raw.includes("function ")) return "document";
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<root") ||
    trimmed.startsWith("<!DOCTYPE")
  )
    return "document";
  const codeSignals = [
    /\bfunction\s+\w+\s*\(/.test(raw),
    /\bclass\s+\w+/.test(raw),
    /^import\s+/m.test(raw),
    /^from\s+\S+\s+import/m.test(raw),
    /\bdef\s+\w+\s*\(/.test(raw),
    /\bfn\s+\w+\s*\(/.test(raw),
    /^(const|let|var)\s+\w+\s*=/m.test(raw),
    /=>\s*\{/.test(raw),
  ];
  if (codeSignals.filter(Boolean).length >= 2) return "code";
  if (/^[A-Z][a-z]+\s*:/m.test(raw) && /\n[A-Z][a-z]+\s*:/m.test(raw))
    return "conversation";
  return "text";
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

function run() {
  console.log("═══ Source Type Detection Tests ═══\n");

  // File extension detection
  assert(detectSourceType("x", "app.ts") === "code", "ext: .ts → code");
  assert(detectSourceType("x", "app.py") === "code", "ext: .py → code");
  assert(
    detectSourceType("x", "data.json") === "document",
    "ext: .json → document",
  );
  assert(
    detectSourceType("x", "config.yaml") === "document",
    "ext: .yaml → document",
  );
  assert(
    detectSourceType("x", "data.csv") === "document",
    "ext: .csv → document",
  );
  assert(detectSourceType("x", "readme.md") === "text", "ext: .md → text");
  assert(detectSourceType("x", "notes.txt") === "text", "ext: .txt → text");

  // URL detection
  assert(detectSourceType("https://example.com") === "url", "url: https");
  assert(detectSourceType("http://example.com") === "url", "url: http");

  // JSON detection
  assert(detectSourceType('{"key": "value"}') === "document", "json: object");
  assert(detectSourceType("[1, 2, 3]") === "document", "json: array");
  assert(
    detectSourceType("{not valid json") === "text",
    "json: invalid → text",
  );

  // Code detection (needs 2+ signals)
  assert(
    detectSourceType("import foo from 'bar';\nconst x = 1;") === "code",
    "code: import + const",
  );
  assert(
    detectSourceType("function hello() {\n  return 1;\n}\nclass Foo {}") ===
      "code",
    "code: function + class",
  );
  assert(
    detectSourceType("def hello():\n  pass\nfrom os import path") === "code",
    "code: python def + from import",
  );

  // Single code signal is NOT enough (avoids false positive on prose mentioning "class")
  assert(
    detectSourceType("The class discussed the topic.") === "text",
    "no false positive: prose with 'class'",
  );
  assert(
    detectSourceType("The function of the heart is to pump blood.") === "text",
    "no false positive: prose with 'function'",
  );

  // Conversation detection
  assert(
    detectSourceType("Alice: Hello\nBob: Hi there") === "conversation",
    "conversation: speaker pattern",
  );
  assert(
    detectSourceType(
      "Interviewer: What do you do?\nCandidate: I write code",
    ) === "conversation",
    "conversation: interview",
  );

  // Plain text
  assert(
    detectSourceType("A marketplace where sellers list products") === "text",
    "text: plain description",
  );
  assert(detectSourceType("") === "text", "text: empty string");

  // File ext overrides content
  assert(
    detectSourceType('{"key": "value"}', "data.ts") === "code",
    "ext override: .ts beats JSON content",
  );

  // YAML content detection
  assert(
    detectSourceType(
      "name: MyApp\nversion: 1.0\nport: 3000\nhost: localhost",
    ) === "document",
    "yaml: key-value content → document",
  );
  assert(
    detectSourceType("just a line\nand another") === "text",
    "yaml: plain lines → text (not yaml)",
  );

  // XML detection
  assert(
    detectSourceType("<?xml version='1.0'?><root></root>") === "document",
    "xml: xml declaration → document",
  );

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
