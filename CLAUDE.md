# structured-world-model

Unified semantic engine: extraction + compilation + governance. Takes any input, extracts structured world models, optionally compiles intent into architectural blueprints with governance artifacts.

## Commands

```bash
pnpm dev <command>     # Run CLI in dev mode
pnpm test              # 557 unit tests (no LLM, no API key)
pnpm test:e2e          # 15 E2E proofs (requires ANTHROPIC_API_KEY)
pnpm typecheck         # TypeScript strict mode (all packages)
pnpm build             # Compile all packages to dist/
```

## Architecture

pnpm monorepo with 10 workspace packages:

```
packages/
  core/             # SWM extraction engine (557 tests)
    src/
      agents/       # LLM agents (extraction, structuring, validation, refinement, second-pass, query, transform)
      schema/       # Zod schemas (WorldModel, Entity, Relation, Process, Constraint)
      pipeline/     # Stage sequencer with timing
      utils/        # Deterministic ops (graph, merge, diff, algebra, coverage, compare, fix, timeline)
      export/       # Output formats (CLAUDE.md, system-prompt, MCP schema)
      serve/        # SWM MCP server (9 tools)
      cli.ts        # 35 CLI commands
      swm.ts        # Main entry: buildWorldModel()
    test/
      unit/         # 557 unit tests across 19 suites
      proof.ts      # 15 E2E proofs

  compiler/         # Ada 9-stage intent compilation (MotherCompiler)
  provenance/       # Content-addressed postcodes, git-backed storage
  config-writer/    # CLAUDE.md, agent files, hooks, BUILD.md generation
  governor/         # Governance decisions, drift detection, confidence
  orchestrator/     # Execution loop, subgoal scheduling, checkpoints
  elicitation/      # Structured intent elicitation, gap analysis
  mcp-server/       # Ada MCP tools + unified server (33+ tools)
  bridge/           # WorldModel <-> Blueprint composition layer
```

## Unified Pipeline

```
Input (text/code/docs/URLs) + Intent
  |
  v
[@swm/core] Extract -> Structure -> Validate -> WorldModel
  |
  v
[@swm/bridge] WorldModel -> compiler seed
  |
  v
[@swm/compiler] CTX -> INT -> PER -> ENT -> PRO -> SYN -> VER -> GOV -> BLD
  |
  v
EnrichedWorldModel (entities + invariants + Hoare triples + bounded contexts)
```

Three entry points:

- `swm model` — extraction only (standalone)
- `swm compile` — compilation only (standalone)
- `swm build` — unified pipeline (extract + compile)

## CLI Commands (35)

**Build:** model, refine, transform, compile, build
**Inspect:** inspect, summary, entities, relations, processes, constraints, search, clusters, subgraph, validate, fix, impact, stats, schema, scan
**Compose:** merge, diff, compare, intersect, subtract, overlay, coverage
**Track:** snapshot, history
**Export:** export (claude-md, system-prompt, mcp, markdown-table)
**Serve:** serve, serve-unified
**Query:** query
**Config:** mcp-config

## Conventions

- TypeScript strict mode, ESM modules
- pnpm workspace monorepo
- All new code must pass `pnpm test && pnpm typecheck`
- Entity IDs use prefixed hex: `ent_`, `rel_`, `proc_`, `cstr_`, `wm_`
- Entity name matching is case-insensitive and trimmed
- Validation agent has 21 issue codes
- Fix command has 13 rules
- Query engine has 10 deterministic graph patterns — LLM fallback is last resort
- All CLI commands accept `-` for stdin JSON input
- Ada packages use @swm/ namespace (renamed from @ada/)

## Key design decisions

- Extraction uses source-type-specific prompts with few-shot examples
- Structuring agent normalizes types to handle LLM variance
- Validation computes quality score (0-100) on every run
- Multi-pass extraction finds implicit entities on second pass
- Bridge maps SWM entities to Ada's 5-category ontology with inferred Hoare triples
- Unified MCP server conditionally registers tools based on available state
- Ada packages imported as-is with ESM compatibility fixes (node: prefix, .js extensions)
