import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;
let defaultModel = "claude-sonnet-4-20250514";

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export function setDefaultModel(model: string): void {
  defaultModel = model;
}

export function getDefaultModel(): string {
  return defaultModel;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallOptions {
  model?: string;
  maxTokens?: number;
  retries?: number;
  timeoutMs?: number;
  cache?: boolean; // Enable prompt caching (default: true)
}

const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_INPUT_TOKENS_WARNING = 150_000;

/** Minimum estimated tokens for prompt caching to be worthwhile (Anthropic requirement). */
const MIN_CACHE_TOKENS = 1024;

/**
 * Build the `system` parameter for the Anthropic API.
 * When caching is enabled and the prompt is long enough, wraps the text in
 * a content block with `cache_control` so repeated calls reuse the cached prefix.
 */
function buildSystemParam(
  systemPrompt: string,
  cache: boolean,
):
  | string
  | Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral" };
    }> {
  if (!cache || estimateTokens(systemPrompt) < MIN_CACHE_TOKENS) {
    return systemPrompt;
  }
  return [
    {
      type: "text" as const,
      text: systemPrompt,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/**
 * Log prompt-cache hit/miss stats when present on a response.
 */
function logCacheUsage(usage: Record<string, unknown>): void {
  const created = usage.cache_creation_input_tokens as number | undefined;
  const read = usage.cache_read_input_tokens as number | undefined;
  if (created || read) {
    process.stderr.write(
      `  [cache] creation=${created ?? 0}  read=${read ?? 0}\n`,
    );
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("socket") ||
      msg.includes("aborted")
    );
  }
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryable(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * delay * 0.3;
        const waitMs = Math.round(delay + jitter);
        process.stderr.write(
          `\n  [retry] ${label} attempt ${attempt + 1}/${retries} failed, retrying in ${waitMs}ms...\n`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Wrap a promise with a timeout. Rejects with a clear error if the timeout fires.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function callAgent(
  systemPrompt: string,
  userMessage: string,
  options?: CallOptions,
): Promise<string> {
  if (!systemPrompt) throw new Error("callAgent: systemPrompt is required");
  if (!userMessage) throw new Error("callAgent: userMessage is required");

  const llm = getClient();
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useCache = options?.cache ?? true;

  return withRetry(
    async () => {
      const apiCall = llm.messages.create({
        model: options?.model ?? defaultModel,
        max_tokens: options?.maxTokens ?? 8192,
        system: buildSystemParam(systemPrompt, useCache),
        messages: [{ role: "user", content: userMessage }],
      });

      const response = await withTimeout(apiCall, timeoutMs, "LLM call");

      logCacheUsage(response.usage as unknown as Record<string, unknown>);

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from LLM");
      }
      return textBlock.text;
    },
    retries,
    "callAgent",
  );
}

export async function callAgentJSON<T>(
  systemPrompt: string,
  userMessage: string,
  options?: CallOptions,
): Promise<T> {
  const retries = options?.retries ?? DEFAULT_RETRIES;

  return withRetry(
    async () => {
      const raw = await callAgent(systemPrompt, userMessage, {
        ...options,
        retries: 0,
      });

      // Extract JSON from markdown code fences if present
      const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

      try {
        return JSON.parse(jsonStr) as T;
      } catch {
        throw new Error(
          `Failed to parse LLM response as JSON (${raw.length} chars):\n${raw.slice(0, 800)}`,
        );
      }
    },
    retries,
    "callAgentJSON",
  );
}

/**
 * Call the LLM with guaranteed structured output via output_config JSON schema.
 * The API constrains the model to produce valid JSON matching the provided schema.
 * Falls back to callAgentJSON if the API rejects the output_config parameter.
 */
export async function callAgentStructured<T>(
  systemPrompt: string,
  userMessage: string,
  jsonSchema: Record<string, unknown>,
  options?: CallOptions,
): Promise<T> {
  if (!systemPrompt)
    throw new Error("callAgentStructured: systemPrompt is required");
  if (!userMessage)
    throw new Error("callAgentStructured: userMessage is required");

  const llm = getClient();
  const model = options?.model ?? defaultModel;
  const maxTokens = options?.maxTokens ?? 16384;
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useCache = options?.cache ?? true;

  return withRetry(
    async () => {
      const apiCall = llm.messages.create({
        model,
        max_tokens: maxTokens,
        system: buildSystemParam(systemPrompt, useCache),
        messages: [{ role: "user", content: userMessage }],
        // @ts-expect-error — output_config is newer than SDK types may expose
        output_config: {
          format: {
            type: "json_schema",
            schema: jsonSchema,
          },
        },
      });

      const response = await withTimeout(
        apiCall,
        timeoutMs,
        "LLM structured call",
      );

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text in structured response");
      }
      return JSON.parse(textBlock.text) as T;
    },
    retries,
    "callAgentStructured",
  );
}

/**
 * Estimate token count from text (rough: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check input size and warn if it's very large.
 * Returns { safe: boolean, tokens: number, warning?: string }
 */
export function checkInputSize(text: string): {
  safe: boolean;
  tokens: number;
  warning?: string;
} {
  const tokens = estimateTokens(text);
  if (tokens > MAX_INPUT_TOKENS_WARNING) {
    return {
      safe: false,
      tokens,
      warning: `Input is ~${tokens.toLocaleString()} tokens (${text.length.toLocaleString()} chars). This exceeds the ${MAX_INPUT_TOKENS_WARNING.toLocaleString()} token warning threshold. The input will be chunked automatically.`,
    };
  }
  return { safe: true, tokens };
}
