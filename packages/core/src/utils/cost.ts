/**
 * Input size estimation and cost prediction.
 * Helps users understand extraction cost before running.
 */

export interface CostEstimate {
  /** Estimated input tokens */
  inputTokens: number;
  /** Estimated output tokens */
  outputTokens: number;
  /** Total estimated tokens */
  totalTokens: number;
  /** Estimated cost in USD (at Sonnet 4.6 rates) */
  estimatedCostUSD: number;
  /** Estimated cost with prompt caching (90% input savings after first call) */
  cachedCostUSD: number;
  /** Estimated duration in seconds */
  estimatedDurationSec: number;
  /** Whether input exceeds recommended size */
  oversized: boolean;
  /** Warnings about the input */
  warnings: string[];
}

// Sonnet 4.6 pricing (per million tokens)
const SONNET_INPUT_PER_MTOK = 3;
const SONNET_OUTPUT_PER_MTOK = 15;
const CACHE_READ_PER_MTOK = 0.3; // 90% savings

// Rough token estimation: ~4 chars per token for English text, ~3 for code
const CHARS_PER_TOKEN_TEXT = 4;
const CHARS_PER_TOKEN_CODE = 3;

// System prompt + schema is roughly this many tokens
const SYSTEM_PROMPT_TOKENS = 2000;

/**
 * Estimate the cost of extracting a world model from input.
 * Does NOT call the API — pure estimation based on input size.
 */
export function estimateCost(
  input: string,
  options?: {
    passes?: number;
    sourceType?:
      | "text"
      | "code"
      | "document"
      | "url"
      | "conversation"
      | "mixed";
    model?: "sonnet" | "opus" | "haiku";
  },
): CostEstimate {
  const passes = options?.passes ?? 1;
  const isCode = options?.sourceType === "code";
  const charsPerToken = isCode ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN_TEXT;

  // Input tokens: system prompt + user content
  const contentTokens = Math.ceil(input.length / charsPerToken);
  const inputTokens = (SYSTEM_PROMPT_TOKENS + contentTokens) * passes;

  // Output tokens: roughly 30-50% of input for extraction
  const outputTokens = Math.ceil(contentTokens * 0.4) * passes;

  const totalTokens = inputTokens + outputTokens;

  // Pricing multipliers by model
  let inputRate = SONNET_INPUT_PER_MTOK;
  let outputRate = SONNET_OUTPUT_PER_MTOK;
  let cacheRate = CACHE_READ_PER_MTOK;

  if (options?.model === "opus") {
    inputRate = 5;
    outputRate = 25;
    cacheRate = 0.5;
  } else if (options?.model === "haiku") {
    inputRate = 1;
    outputRate = 5;
    cacheRate = 0.1;
  }

  const estimatedCostUSD =
    (inputTokens / 1_000_000) * inputRate +
    (outputTokens / 1_000_000) * outputRate;

  // With caching: system prompt cached after first call
  const cachedInputTokens = SYSTEM_PROMPT_TOKENS + contentTokens; // first call
  const cachedSubsequentTokens = contentTokens * (passes - 1); // subsequent calls use cache
  const cachedSystemTokens = SYSTEM_PROMPT_TOKENS * (passes - 1); // these are cached
  const cachedCostUSD =
    (cachedInputTokens / 1_000_000) * inputRate +
    (cachedSubsequentTokens / 1_000_000) * inputRate +
    (cachedSystemTokens / 1_000_000) * cacheRate +
    (outputTokens / 1_000_000) * outputRate;

  // Duration estimate: ~30 tokens/sec output
  const estimatedDurationSec = Math.ceil(outputTokens / 30);

  // Warnings
  const warnings: string[] = [];
  const oversized = contentTokens > 100_000;
  if (oversized) {
    warnings.push(
      `Input is ~${Math.round(contentTokens / 1000)}K tokens — consider splitting into smaller files`,
    );
  }
  if (contentTokens > 50_000 && passes > 1) {
    warnings.push(
      "Large input with multi-pass may be expensive — consider single pass first",
    );
  }
  if (contentTokens < 50) {
    warnings.push("Very short input — extraction quality may be limited");
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000,
    cachedCostUSD: Math.round(cachedCostUSD * 10000) / 10000,
    estimatedDurationSec,
    oversized,
    warnings,
  };
}
