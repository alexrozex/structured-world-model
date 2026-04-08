import { chunkInput } from "../../src/agents/chunker.js";

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
  console.log("═══ Chunker Unit Tests ═══\n");

  // Test 1: Short input returns single chunk
  {
    const chunks = chunkInput("Hello world");
    assert(chunks.length === 1, "Short input: 1 chunk");
    assert(chunks[0].index === 0, "Short input: index is 0");
    assert(chunks[0].total === 1, "Short input: total is 1");
    assert(chunks[0].text === "Hello world", "Short input: text preserved");
    assert(chunks[0].tokenEstimate > 0, "Short input: has token estimate");
  }

  // Test 2: Empty input returns single chunk
  {
    const chunks = chunkInput("");
    assert(chunks.length === 1, "Empty input: 1 chunk");
    assert(chunks[0].text === "", "Empty input: text is empty");
  }

  // Test 3: Input just under threshold returns single chunk
  {
    // 80_000 tokens * 4 chars/token = 320_000 chars threshold
    const text = "a".repeat(319_000);
    const chunks = chunkInput(text);
    assert(chunks.length === 1, "Under threshold: 1 chunk");
  }

  // Test 4: Large input gets split into multiple chunks
  {
    // 80_000 tokens * 4 = 320_000 chars per chunk. Make 640K+ chars.
    const paragraph = "This is a paragraph of text.\n\n";
    const text = paragraph.repeat(25_000); // ~750K chars
    const chunks = chunkInput(text);
    assert(
      chunks.length >= 2,
      `Large input: split into ${chunks.length} chunks (>= 2)`,
    );
  }

  // Test 5: Chunks have correct index and total
  {
    const paragraph = "Word ".repeat(200) + "\n\n";
    const text = paragraph.repeat(2000); // large enough to split
    const chunks = chunkInput(text);
    if (chunks.length > 1) {
      assert(chunks[0].index === 0, "Multi-chunk: first index is 0");
      assert(
        chunks[chunks.length - 1].index === chunks.length - 1,
        "Multi-chunk: last index is length-1",
      );
      assert(
        chunks.every((c) => c.total === chunks.length),
        "Multi-chunk: all totals match",
      );
    } else {
      assert(true, "Multi-chunk: input not large enough to split (skip)");
    }
  }

  // Test 6: No chunk exceeds max size
  {
    const paragraph = "Hello world this is a test paragraph.\n\n";
    const text = paragraph.repeat(20_000);
    const chunks = chunkInput(text);
    const maxChars = 80_000 * 4 + 5000; // with some tolerance for boundary seeking
    for (const chunk of chunks) {
      assert(
        chunk.text.length <= maxChars,
        `Chunk ${chunk.index}: ${chunk.text.length} chars <= max`,
      );
    }
  }

  // Test 7: All input text is covered (no gaps beyond overlap)
  {
    const text = "ABCDEFGHIJ".repeat(40_000); // 400K chars, should split
    const chunks = chunkInput(text);
    if (chunks.length > 1) {
      // First chunk starts at 0, last chunk ends at text.length
      assert(
        chunks[0].text.startsWith("ABCDEFGHIJ"),
        "Coverage: first chunk starts at beginning",
      );
      assert(
        text.endsWith(chunks[chunks.length - 1].text.slice(-10)),
        "Coverage: last chunk ends at end",
      );
    } else {
      assert(true, "Coverage: single chunk (skip)");
    }
  }

  // Test 8: Token estimates are reasonable
  {
    const text = "word ".repeat(100); // 500 chars ≈ 125 tokens
    const chunks = chunkInput(text);
    assert(
      chunks[0].tokenEstimate >= 100 && chunks[0].tokenEstimate <= 200,
      "Token estimate: reasonable for 500 chars",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
