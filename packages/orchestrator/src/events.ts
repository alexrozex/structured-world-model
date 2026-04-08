import type { ClaudeEvent, RawAnthropicEvent } from "./types.js";

export function parseStreamJsonLine(line: string): ClaudeEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as {
      uuid?: string;
      session_id?: string;
      parent_tool_use_id?: string | null;
      event?: RawAnthropicEvent;
    };
    if (!parsed.uuid || !parsed.session_id || !parsed.event) return null;
    return {
      uuid: parsed.uuid,
      session_id: parsed.session_id,
      parent_tool_use_id: parsed.parent_tool_use_id ?? null,
      event: parsed.event,
    };
  } catch {
    return null;
  }
}

export function isToolUseEvent(event: ClaudeEvent): boolean {
  return event.event.type === "content_block_start" &&
    (event.event as Record<string, unknown>)["content_block"] !== undefined &&
    ((event.event as Record<string, unknown>)["content_block"] as Record<string, unknown>)["type"] === "tool_use";
}

export function isSubagentEvent(event: ClaudeEvent): boolean {
  return event.parent_tool_use_id !== null;
}
