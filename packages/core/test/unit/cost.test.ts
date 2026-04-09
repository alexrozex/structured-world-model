/**
 * Tests for cost estimation.
 */

import { estimateCost } from "../../src/utils/cost.js";

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

function run() {
  console.log(
    "\n\u2500\u2500\u2500 Cost Estimation Tests \u2500\u2500\u2500\n",
  );

  // Basic estimation
  {
    const r = estimateCost("A simple marketplace with users and products");
    assert(r.inputTokens > 0, "basic: positive input tokens");
    assert(r.outputTokens > 0, "basic: positive output tokens");
    assert(
      r.totalTokens === r.inputTokens + r.outputTokens,
      "basic: total = input + output",
    );
    assert(r.estimatedCostUSD > 0, "basic: positive cost");
    assert(r.estimatedDurationSec > 0, "basic: positive duration");
    assert(!r.oversized, "basic: not oversized");
    assert(
      r.warnings.length === 0 || r.warnings.some((w) => w.includes("short")),
      "basic: no warnings or short input warning",
    );
  }

  // Longer input costs more
  {
    const short = estimateCost("hello");
    const long = estimateCost("A".repeat(10000));
    assert(
      long.inputTokens > short.inputTokens,
      "scaling: longer input = more tokens",
    );
    assert(
      long.estimatedCostUSD > short.estimatedCostUSD,
      "scaling: longer input = higher cost",
    );
  }

  // Multi-pass costs more
  {
    const single = estimateCost("Test input", { passes: 1 });
    const multi = estimateCost("Test input", { passes: 2 });
    assert(
      multi.inputTokens > single.inputTokens,
      "passes: 2 passes = more tokens",
    );
    assert(
      multi.estimatedCostUSD > single.estimatedCostUSD,
      "passes: 2 passes = higher cost",
    );
  }

  // Code input uses different token ratio
  {
    const text = estimateCost("A".repeat(1000), { sourceType: "text" });
    const code = estimateCost("A".repeat(1000), { sourceType: "code" });
    assert(
      code.inputTokens > text.inputTokens,
      "code: more tokens per char than text",
    );
  }

  // Opus costs more than Sonnet
  {
    const sonnet = estimateCost("Test input", { model: "sonnet" });
    const opus = estimateCost("Test input", { model: "opus" });
    assert(
      opus.estimatedCostUSD > sonnet.estimatedCostUSD,
      "opus: costs more than sonnet",
    );
  }

  // Haiku costs less than Sonnet
  {
    const sonnet = estimateCost("Test input", { model: "sonnet" });
    const haiku = estimateCost("Test input", { model: "haiku" });
    assert(
      haiku.estimatedCostUSD < sonnet.estimatedCostUSD,
      "haiku: costs less than sonnet",
    );
  }

  // Cached cost is less than uncached for multi-pass
  {
    const r = estimateCost("Test input for caching analysis", { passes: 2 });
    assert(
      r.cachedCostUSD <= r.estimatedCostUSD,
      "cache: cached cost <= uncached",
    );
  }

  // Oversized input flagged
  {
    const big = estimateCost("A".repeat(500000));
    assert(big.oversized, "oversized: 500K chars flagged");
    assert(
      big.warnings.some((w) => w.includes("splitting")),
      "oversized: splitting warning",
    );
  }

  // Very short input warning
  {
    const tiny = estimateCost("Hi");
    assert(
      tiny.warnings.some((w) => w.includes("short")),
      "tiny: short input warning",
    );
  }

  // Large multi-pass warning
  {
    const bigMulti = estimateCost("A".repeat(250000), { passes: 2 });
    assert(
      bigMulti.warnings.some((w) => w.includes("expensive")),
      "big multi: expense warning",
    );
  }

  // Default model is sonnet
  {
    const def = estimateCost("Test");
    const sonnet = estimateCost("Test", { model: "sonnet" });
    assert(
      def.estimatedCostUSD === sonnet.estimatedCostUSD,
      "default: same cost as sonnet",
    );
  }

  // Duration scales with output
  {
    const short = estimateCost("short");
    const long = estimateCost("A".repeat(50000));
    assert(
      long.estimatedDurationSec > short.estimatedDurationSec,
      "duration: scales with size",
    );
  }

  // Zero-length input doesn't crash
  {
    const empty = estimateCost("");
    assert(empty.inputTokens > 0, "empty: still has system prompt tokens");
    assert(empty.estimatedCostUSD >= 0, "empty: non-negative cost");
  }

  // 3 passes costs 3x single
  {
    const s1 = estimateCost("Test input", { passes: 1 });
    const s3 = estimateCost("Test input", { passes: 3 });
    assert(s3.inputTokens > s1.inputTokens * 2, "3 passes: > 2x single tokens");
  }

  // Document source type uses text rate
  {
    const doc = estimateCost("A".repeat(1000), { sourceType: "document" });
    const text = estimateCost("A".repeat(1000), { sourceType: "text" });
    assert(doc.inputTokens === text.inputTokens, "document: same rate as text");
  }

  // Oversized threshold is 100K tokens
  {
    const justUnder = estimateCost("A".repeat(399000)); // ~100K tokens at 4 chars/tok
    const justOver = estimateCost("A".repeat(401000));
    assert(!justUnder.oversized, "just under 100K: not oversized");
    assert(justOver.oversized, "just over 100K: oversized");
  }

  // Cached cost equals uncached for single pass
  {
    const r = estimateCost("Single pass test", { passes: 1 });
    assert(
      r.cachedCostUSD === r.estimatedCostUSD,
      "single pass: cached = uncached",
    );
  }

  // All models return positive output tokens
  {
    for (const m of ["sonnet", "opus", "haiku"] as const) {
      const r = estimateCost("Test", { model: m });
      assert(r.outputTokens > 0, `${m}: positive output tokens`);
    }
  }

  // Duration is at least 1 second for any non-trivial input
  {
    const r = estimateCost("A".repeat(1000));
    assert(r.estimatedDurationSec >= 1, "1K chars: at least 1s duration");
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
