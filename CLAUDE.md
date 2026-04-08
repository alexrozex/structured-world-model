# structured-world-model

Agentic software that turns any input into structured, validated, queryable world models.

## Commands

```bash
pnpm dev <command>     # Run CLI in dev mode
pnpm test              # 478 unit tests (no LLM, no API key)
pnpm test:e2e          # 15 E2E proofs (requires ANTHROPIC_API_KEY)
pnpm typecheck         # TypeScript strict mode
pnpm build             # Compile to dist/
```

## Architecture

```
src/
  agents/         # LLM-powered agents (extraction, second-pass, query, transform, refinement)
  schema/         # Zod schemas (WorldModel, Entity, Relation, Process, Constraint, ValidationResult)
  pipeline/       # Pipeline orchestrator (stage sequencing with timing)
  utils/          # Deterministic operations (graph, merge, diff, algebra, coverage, compare, fix, timeline, fetch, ids)
  export/         # Output formats (CLAUDE.md, system-prompt, MCP schema)
  serve/          # Live MCP server (9 tools served via stdio)
  cli.ts          # 31 CLI commands
  swm.ts          # Main entry: buildWorldModel()
  index.ts        # Public API exports

test/
  unit/           # 478 tests across 16 suites (no LLM calls)
  proof.ts        # 15 E2E proofs (requires API key)
  run-unit.ts     # Test runner
```

## Conventions

- TypeScript strict mode, ESM modules
- pnpm as package manager
- All new code must pass `pnpm test && pnpm typecheck`
- Entity IDs use prefixed hex: `ent_`, `rel_`, `proc_`, `cstr_`, `wm_`
- Entity name matching is case-insensitive and trimmed
- Validation agent has 20 issue codes — check before adding duplicates
- Fix command has 12 rules — runs entity dedup and placeholder removal first
- Query engine has 10 deterministic graph patterns — LLM fallback is last resort
- All CLI commands accept `-` for stdin JSON input

## Key design decisions

- Extraction uses source-type-specific prompts with few-shot examples
- Structuring agent normalizes types (entity, relation, constraint) to handle LLM variance
- Validation computes quality score (0-100) on every run
- Fix re-validates after cleaning so score reflects the fixed model
- Multi-pass extraction retries on empty results (up to 2 retries)
- MCP server serves any world model as 9 queryable tools
