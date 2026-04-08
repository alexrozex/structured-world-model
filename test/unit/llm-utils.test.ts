import { estimateTokens, checkInputSize } from "../../src/utils/llm.js";

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
  console.log("═══ LLM Utils Unit Tests ═══\n");

  // estimateTokens
  assert(estimateTokens("") === 0, "estimateTokens: empty string = 0");
  assert(estimateTokens("word") === 1, "estimateTokens: 4 chars = 1 token");
  assert(
    estimateTokens("hello world!") === 3,
    "estimateTokens: 12 chars = 3 tokens",
  );
  assert(
    estimateTokens("a".repeat(400)) === 100,
    "estimateTokens: 400 chars = 100 tokens",
  );
  assert(
    estimateTokens("a".repeat(401)) === 101,
    "estimateTokens: 401 chars = 101 (ceil)",
  );

  // checkInputSize
  {
    const small = checkInputSize("hello");
    assert(small.safe === true, "checkInputSize: small input is safe");
    assert(small.tokens > 0, "checkInputSize: returns token count");
    assert(
      small.warning === undefined,
      "checkInputSize: no warning for small input",
    );
  }

  {
    const big = checkInputSize("a".repeat(700_000)); // 175K tokens
    assert(big.safe === false, "checkInputSize: large input is not safe");
    assert(
      big.warning !== undefined,
      "checkInputSize: warning for large input",
    );
    assert(
      big.warning!.includes("150,000"),
      "checkInputSize: warning mentions threshold",
    );
  }

  {
    const boundary = checkInputSize("a".repeat(600_000)); // exactly 150K tokens
    assert(
      boundary.safe === true,
      "checkInputSize: exactly at threshold is safe",
    );
  }

  {
    const justOver = checkInputSize("a".repeat(600_001)); // 150K + 1
    assert(
      justOver.safe === false,
      "checkInputSize: 1 over threshold is not safe",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
