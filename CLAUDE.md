# structured-world-model

Unified semantic engine: extraction + compilation + governance. Takes any input, extracts structured world models, optionally compiles intent into architectural blueprints with governance artifacts.

## Commands

```bash
pnpm dev <command>     # Run CLI in dev mode
pnpm test              # 1100+ unit tests (no LLM, no API key)
pnpm test:e2e          # 17 E2E proofs (requires ANTHROPIC_API_KEY)
pnpm typecheck         # TypeScript strict mode (all packages)
pnpm build             # Compile all packages to dist/
```

## Architecture

pnpm monorepo with 10 workspace packages:

```
packages/
  core/             # SWM extraction engine (1100+ tests)
    src/
      agents/       # LLM agents (extraction, structuring, validation, refinement, second-pass, query, transform)
      schema/       # Zod schemas (WorldModel, Entity, Relation, Process, Constraint)
      pipeline/     # Stage sequencer with timing
      utils/        # Deterministic ops (graph, merge, diff, algebra, coverage, compare, fix, timeline, filter, versioning, health, cost, serialize, loader)
      export/       # Output formats (CLAUDE.md, system-prompt, MCP schema, HTML, markdown-table)
      serve/        # SWM MCP server (10 tools, hot-reload)
      cli.ts        # 39 CLI commands
      swm.ts        # Main entry: buildWorldModel() with auto-fix
      swm-quick.ts  # One-liner: swm() returns model + validation + health + exports + cost
    test/
      unit/         # 1100+ tests across 30+ suites
      proof.ts      # 17 E2E proofs

  compiler/         # Ada 9-stage intent compilation (MotherCompiler)
  provenance/       # Content-addressed postcodes, git-backed storage
  config-writer/    # CLAUDE.md, agent files, hooks, BUILD.md generation
  governor/         # Governance decisions, drift detection, confidence
  orchestrator/     # Execution loop, subgoal scheduling, checkpoints
  elicitation/      # Structured intent elicitation, gap analysis
  mcp-server/       # Ada MCP tools + unified server (33+ tools)
  bridge/           # WorldModel <-> Blueprint composition layer (111 tests)
```

## Quick API

```typescript
import { swm } from "@swm/core";
const r = await swm("A marketplace for freelancers...");
r.model; // WorldModel with entities, relations, processes, constraints
r.validation; // score 0-100, issues
r.health; // grade A-F, metrics, recommendations
r.exports; // claudeMd, systemPrompt, mcpSchema, html, json, markdownTable
r.cost; // estimated tokens, USD, duration
```

## CLI Commands (39)

**Build:** model, refine, transform, compile, build
**Inspect:** inspect, summary, entities, relations, processes, constraints, search, clusters, subgraph, validate, fix, impact, stats, schema, scan, health, info
**Compose:** merge, diff, compare, intersect, subtract, overlay, coverage, filter
**Track:** snapshot, history
**Export:** export (9 formats: claude-md, system-prompt, mcp, markdown-table, html, yaml, json, dot, mermaid)
**Serve:** serve, serve-unified
**Query:** query (--explain shows matched pattern)
**Tools:** estimate, mcp-config

## Key Features

- **Auto-fix pipeline**: buildWorldModel() automatically cleans noise entities, dangling refs, orphans. Code extraction goes from 26→100 quality.
- **Structured outputs**: all 4 LLM agents use JSON schema constrained decoding with fallback to prompt-based JSON.
- **Prompt caching**: system prompts cached for 90% input cost reduction on repeated calls.
- **Full provenance**: source_context on all 4 element types (entities, relations, processes, constraints) traces back to source input.
- **Fuzzy coverage**: coverage analysis uses word-overlap matching (threshold 0.5) to catch semantic equivalents.
- **Health assessment**: assessHealth() returns Grade A-F with metrics (relation density, confidence rate, provenance rate, orphan rate, cluster count).
- **Cost estimation**: estimateCost() predicts tokens, USD, duration before running extraction.
- **Model versioning**: bumpVersion/versionModel/compareVersions for tracking model evolution.
- **Model filtering**: filterModel() by entity type, tag, confidence, search term, constraint severity.

## Public API (65+ exports)

Core: buildWorldModel, swm, Pipeline
Agents: extractionAgent, structuringAgent, validationAgent, secondPassAgent, refineWorldModel, queryWorldModel, transformWorldModel
Graph: findEntity, findDependents, pathsBetween, toMermaid, toDot, getStats, summarize, subgraph, findClusters, analyzeImpact
Compose: mergeWorldModels, diffWorldModels, detectMergeConflicts, compare, intersection, difference, overlay, coverage, filterModel
Export: toClaudeMd, toSystemPrompt, toMcpSchema, toMarkdownTable, toHtml, getWorldModelJsonSchema
Utils: fixWorldModel, assessHealth, estimateCost, bumpVersion, versionModel, compareVersions, parseWorldModel, validateWorldModel, loadWorldModelFromFile, toCompactJSON, toPrettyJSON, toYAML, modelSize, genId, setDefaultModel, getDefaultModel
Timeline: createTimeline, addSnapshot, entityHistory, timelineSummary, snapshotChangelog
Schema: validateExtraction, getRawExtractionJsonSchema
MCP: startMcpServer

## Conventions

- TypeScript strict mode, ESM modules
- pnpm workspace monorepo
- All new code must pass `pnpm test && pnpm typecheck`
- Entity IDs use prefixed hex: `ent_`, `rel_`, `proc_`, `cstr_`, `wm_`
- Entity name matching is case-insensitive and trimmed
- Validation agent has 23+ issue codes (including EMPTY_PROPERTIES, LOW_RELATION_DENSITY, SPARSE_GRAPH)
- Fix command has 15+ rules including noise entity removal
- Query engine has 10 deterministic graph patterns with --explain flag
- All CLI commands accept `-` for stdin JSON input
- All inspect commands support --json for scriptable output
- Ada packages use @swm/ namespace (renamed from @ada/)
