# Anthropic Capabilities (April 2026)

## Highest-Impact for SWM (ranked)

### 1. Structured Outputs (GA)

Pass WorldModel Zod schema as `output_config.format.type: "json_schema"`. Eliminates all JSON parsing failures. Use `zod-to-json-schema` to convert.

```typescript
output_config: {
  format: { type: "json_schema", schema: worldModelJsonSchema }
}
```

### 2. Extended Thinking (Adaptive)

`thinking.type: "adaptive"` with `effort: "high"` for extraction, `"low"` for validation. Interleaved thinking between tool calls on Opus/Sonnet 4.6.

### 3. Prompt Caching (1hr)

Cache system prompt + schema (20k tokens). 90% cost reduction on repeated calls. Cached tokens don't count toward rate limits.

- 5min cache: 1.25x write, 0.1x read
- 1hr cache: 2x write, 0.1x read

### 4. Citations

Exact source references for extracted entities. `cited_text` doesn't count toward output tokens. Enables provenance tracking.

### 5. Batch API + 300k Output

50% discount. 300k output tokens per request on Opus/Sonnet 4.6 (beta header). Bulk extraction of large corpora.

### 6. Claude Agent SDK

Programmatic agent with built-in tools, subagents, hooks. Python + TypeScript. Same capabilities as Claude Code, embeddable.

### 7. Managed Agents (Beta)

Cloud-hosted agents with persistent sessions. $0.08/session-hour + token costs. No client infra needed.

### 8. MCP Connector (Beta)

Connect MCP servers directly in Messages API calls. No client-side MCP plumbing.

## Models

| Model      | Context | Max Output        | Input $/MTok | Output $/MTok |
| ---------- | ------- | ----------------- | ------------ | ------------- |
| Opus 4.6   | 1M      | 128k (300k batch) | $5           | $25           |
| Sonnet 4.6 | 1M      | 64k (300k batch)  | $3           | $15           |
| Haiku 4.5  | 200k    | 64k               | $1           | $5            |

Batch: 50% off. Cache reads: 90% off.

## Rate Limits (Tier 4)

- 4,000 RPM, 2M ITPM, 400k OTPM
- Cached tokens don't count toward ITPM

## Implementation Priority for SWM

1. **Now**: Add structured outputs to extraction agent (eliminates parsing retries)
2. **Now**: Add prompt caching to system prompts (90% cost cut)
3. **Next**: Add extended thinking with adaptive effort
4. **Next**: Add citations for entity-level provenance
5. **Later**: Rebuild pipeline with Agent SDK for production service
6. **Later**: Distribute as remote MCP server via Streamable HTTP
