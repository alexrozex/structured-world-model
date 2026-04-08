/**
 * Unit tests for parseStreamJsonLine, isToolUseEvent, isSubagentEvent — pure functions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStreamJsonLine,
  isToolUseEvent,
  isSubagentEvent,
} from "./events.js";

// ─── parseStreamJsonLine ──────────────────────────────────────────────────────

test("returns null for empty line", () => {
  assert.equal(parseStreamJsonLine(""), null);
  assert.equal(parseStreamJsonLine("   "), null);
});

test("returns null for invalid JSON", () => {
  assert.equal(parseStreamJsonLine("{not json}"), null);
});

test("returns null when missing required fields", () => {
  // missing session_id
  assert.equal(
    parseStreamJsonLine('{"uuid":"u1","event":{"type":"content_block_start"}}'),
    null,
  );
  // missing uuid
  assert.equal(
    parseStreamJsonLine(
      '{"session_id":"s1","event":{"type":"content_block_start"}}',
    ),
    null,
  );
  // missing event
  assert.equal(parseStreamJsonLine('{"uuid":"u1","session_id":"s1"}'), null);
});

test("parses valid stream-json line", () => {
  const line = JSON.stringify({
    uuid: "abc-123",
    session_id: "sess-1",
    parent_tool_use_id: null,
    event: { type: "content_block_start" },
  });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.uuid, "abc-123");
  assert.equal(result.session_id, "sess-1");
  assert.equal(result.parent_tool_use_id, null);
  assert.equal(result.event.type, "content_block_start");
});

test("defaults parent_tool_use_id to null when absent", () => {
  const line = JSON.stringify({
    uuid: "abc-123",
    session_id: "sess-1",
    event: { type: "message_start" },
  });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.parent_tool_use_id, null);
});

test("preserves non-null parent_tool_use_id", () => {
  const line = JSON.stringify({
    uuid: "abc-123",
    session_id: "sess-1",
    parent_tool_use_id: "tool-use-xyz",
    event: { type: "message_stop" },
  });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.parent_tool_use_id, "tool-use-xyz");
});

// ─── isSubagentEvent ──────────────────────────────────────────────────────────

test("isSubagentEvent is true when parent_tool_use_id is non-null", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: "tool-123",
    event: { type: "message_stop" },
  };
  assert.equal(isSubagentEvent(event), true);
});

test("isSubagentEvent is false when parent_tool_use_id is null", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: null,
    event: { type: "message_stop" },
  };
  assert.equal(isSubagentEvent(event), false);
});

// ─── isToolUseEvent ───────────────────────────────────────────────────────────

test("isToolUseEvent is false for non-tool events", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: null,
    event: { type: "message_start" },
  };
  assert.equal(isToolUseEvent(event), false);
});

test("isToolUseEvent is false for content_block_start without content_block", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: null,
    event: { type: "content_block_start" },
  };
  assert.equal(isToolUseEvent(event), false);
});

test("isToolUseEvent is true for tool_use content_block_start", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "toolu_01",
        name: "Bash",
        input: {},
      },
    },
  };
  assert.equal(isToolUseEvent(event), true);
});

test("isToolUseEvent is false for text content_block_start", () => {
  const event = {
    uuid: "u1",
    session_id: "s1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_start",
      content_block: { type: "text", text: "Hello" },
    },
  };
  assert.equal(isToolUseEvent(event), false);
});
