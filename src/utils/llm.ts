import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
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
}

const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // Rate limit, server errors, overloaded
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("socket")
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

export async function callAgent(
  systemPrompt: string,
  userMessage: string,
  options?: CallOptions,
): Promise<string> {
  const llm = getClient();
  const retries = options?.retries ?? DEFAULT_RETRIES;

  return withRetry(
    async () => {
      const response = await llm.messages.create({
        model: options?.model ?? "claude-sonnet-4-20250514",
        max_tokens: options?.maxTokens ?? 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

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
  let lastParseErr: Error | null = null;

  // Retry JSON parsing failures too — LLM sometimes returns malformed JSON on first try
  return withRetry(
    async () => {
      const raw = await callAgent(systemPrompt, userMessage, {
        ...options,
        retries: 0, // inner call doesn't retry — outer loop handles it
      });

      // Extract JSON from markdown code fences if present
      const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

      try {
        return JSON.parse(jsonStr) as T;
      } catch {
        lastParseErr = new Error(
          `Failed to parse LLM response as JSON (${raw.length} chars):\n${raw.slice(0, 800)}`,
        );
        throw lastParseErr;
      }
    },
    retries,
    "callAgentJSON",
  );
}

/**
 * Estimate token count from text (rough: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
