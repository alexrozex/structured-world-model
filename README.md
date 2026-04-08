# structured-world-model

The universal lens. Point it at anything — text, code, conversations, documents, URLs — and get a structured, validated, queryable world model out.

```
ANY INPUT → Extract → Structure → Validate → WORLD MODEL
                                                  ↓
                              Query / Compose / Export / Serve
```

## Install

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-...
```

## Quick Start

```bash
# From text
pnpm dev model "A marketplace where sellers list products and buyers purchase them"

# From a file
pnpm dev model -f spec.md

# From a URL
pnpm dev model https://example.com/docs

# From stdin
cat architecture.md | pnpm dev model

# Multi-pass (deeper extraction)
pnpm dev model -f spec.md --passes 2

# Auto-fix + quality gate
pnpm dev model -f spec.md --fix --min-score 70

# Choose model (opus for quality, haiku for speed)
pnpm dev model -f spec.md -m claude-opus-4-20250514

# Pipe through commands
pnpm dev model -f spec.md | pnpm dev fix - | pnpm dev validate -
```

## Commands

Run `swm help` for the full grouped reference. All commands accepting `<model>` support `-` for stdin.

### Build

| Command                                  | Description                                        |
| ---------------------------------------- | -------------------------------------------------- |
| `swm model [input]`                      | Build a world model from text, file, URL, or stdin |
| `swm model -f file -p 2`                 | Multi-pass extraction (finds implicit entities)    |
| `swm model --fix --min-score 70`         | Auto-fix + quality gate                            |
| `swm refine model.json "new info"`       | Incrementally refine with new input                |
| `swm transform model.json "instruction"` | Apply natural language transformation              |

### Inspect

| Command                                     | Description                                                 |
| ------------------------------------------- | ----------------------------------------------------------- |
| `swm inspect model.json`                    | Stats, most connected entities, confidence                  |
| `swm inspect model.json -e "User"`          | Entity lookup with all relations and constraints            |
| `swm summary model.json`                    | One-line natural language summary (no LLM)                  |
| `swm entities model.json`                   | List all entities (filterable: `-t actor`)                  |
| `swm relations model.json`                  | List all relations (filterable: `-t depends_on`)            |
| `swm processes model.json`                  | List all processes with steps and actors                    |
| `swm constraints model.json`                | List all constraints (filterable: `-s hard`)                |
| `swm search model.json "term"`              | Full-text search across all elements                        |
| `swm clusters model.json`                   | Find natural entity groups (connected components)           |
| `swm subgraph model.json "Entity" --hops 2` | Extract neighborhood around an entity                       |
| `swm validate model.json`                   | Full integrity check with quality score (exits 1 on errors) |
| `swm fix model.json`                        | Auto-fix: orphans, dangling refs, duplicates, step ordering |
| `swm stats *.json`                          | Multi-model comparison table with scores                    |
| `swm schema`                                | Output WorldModel JSON Schema (draft-2020-12)               |

### Compose

| Command                             | Description                                     |
| ----------------------------------- | ----------------------------------------------- |
| `swm merge a.json b.json`           | Union two models (deduplicates entities)        |
| `swm diff before.json after.json`   | What changed between two models                 |
| `swm intersect a.json b.json`       | Entities shared by both models                  |
| `swm subtract a.json b.json`        | Entities in A but not in B                      |
| `swm overlay base.json lens.json`   | Apply constraints/relations from lens onto base |
| `swm coverage ref.json target.json` | Measure how much of ref is covered by target    |

### Track

| Command                               | Description                                |
| ------------------------------------- | ------------------------------------------ |
| `swm snapshot model.json`             | Add to timeline (auto-diffs from previous) |
| `swm history timeline.json`           | Show evolution over time                   |
| `swm history timeline.json -e "User"` | Track one entity across snapshots          |

### Export

| Command                                    | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| `swm export model.json --as claude-md`     | CLAUDE.md — governing context for AI agents  |
| `swm export model.json --as system-prompt` | System prompt — makes an LLM a domain expert |
| `swm export model.json --as mcp`           | MCP tool definitions for agent integration   |

### Serve

| Command                | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `swm serve model.json` | Start MCP server — any AI agent gets instant domain expertise |

8 tools: `get_entity`, `get_relations`, `find_path`, `get_process`, `check_constraint`, `query`, `get_stats`, `get_diagram`

### Query

| Command                           | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `swm query model.json "question"` | Natural language queries (graph patterns + LLM inference) |

9 deterministic graph patterns (no LLM needed): what depends on X, what does X use, path between X and Y, constraints for X, describe X, list all [type], processes involving X, stats, how many.

## World Model Schema

```typescript
WorldModel {
  entities:    Entity[]      // actors, objects, systems, concepts, locations, events, groups, resources
  relations:   Relation[]    // 17 typed directed edges (uses, depends_on, produces, contains, ...)
  processes:   Process[]     // ordered steps with actors, inputs, outputs, outcomes
  constraints: Constraint[]  // hard/soft rules with scoped enforcement
  metadata:    { source_type, confidence, extraction_notes }
}
```

Each entity carries optional `confidence` (0-1) and `properties`. Quality `score` (0-100) computed on every validation.

## Programmatic API

```typescript
import {
  buildWorldModel,
  queryWorldModel,
  transformWorldModel,
  mergeWorldModels,
  diffWorldModels,
  intersection,
  difference,
  overlay,
  coverage,
  fixWorldModel,
  toClaudeMd,
  toSystemPrompt,
  toMcpSchema,
  getWorldModelJsonSchema,
  refineWorldModel,
  findEntity,
  findDependents,
  pathsBetween,
  subgraph,
  findClusters,
  summarize,
  toMermaid,
  toDot,
  getStats,
  createTimeline,
  addSnapshot,
  entityHistory,
} from "structured-world-model";

// Build with quality gate
const result = await buildWorldModel(
  { raw: "your input", sourceType: "text" },
  { passes: 2, model: "claude-sonnet-4-20250514" },
);

// Query (deterministic graph patterns, no LLM for structural questions)
const answer = await queryWorldModel(
  result.worldModel,
  "what depends on the database?",
);

// Transform (LLM-powered mutations)
const { model } = await transformWorldModel(
  result.worldModel,
  "Add authentication to all API endpoints",
);

// Compose
const merged = mergeWorldModels(modelA, modelB);
const shared = intersection(modelA, modelB);
const governed = overlay(baseModel, permissionsModel);
const cov = coverage(specModel, codeModel); // requirements traceability

// Auto-fix
const { model: fixed, fixes } = fixWorldModel(result.worldModel);

// Export as AI-consumable context
const claudeMd = toClaudeMd(result.worldModel);
const prompt = toSystemPrompt(result.worldModel);
```

## Multi-Pass Extraction

Single pass extracts what's stated. Multi-pass (`--passes 2`) runs a second agent that finds what's implicit:

|             | 1-pass | 2-pass |
| ----------- | ------ | ------ |
| Entities    | 29     | 46     |
| Relations   | 28     | 45     |
| Processes   | 3      | 6      |
| Constraints | 7      | 12     |

The second pass finds infrastructure (auth, logging, error handling), process intermediaries, and unstated constraints.

## Validation & Quality Score

21 validation checks: dangling references, orphan entities, circular dependencies, duplicate names, weak descriptions, low type diversity, step ordering, empty processes, completeness, low confidence, missing metadata, disconnected subgraphs, deep dependency chains, missing triggers.

Quality score (0-100) computed from issue count, completeness, relation density, type diversity, and confidence. Use `--min-score` as a CI gate.

## Tests

```bash
pnpm test          # 506 unit tests (no LLM calls)
pnpm test:e2e      # 15 end-to-end proofs (requires API key)
pnpm typecheck     # TypeScript strict mode
```
