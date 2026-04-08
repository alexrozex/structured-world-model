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

export async function callAgent(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number },
): Promise<string> {
  const llm = getClient();
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
}

export async function callAgentJSON<T>(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number },
): Promise<T> {
  const raw = await callAgent(systemPrompt, userMessage, options);

  // Extract JSON from markdown code fences if present
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    throw new Error(
      `Failed to parse LLM response as JSON:\n${raw.slice(0, 500)}`,
    );
  }
}
