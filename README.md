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

# Output as YAML / Mermaid / DOT
pnpm dev model -f input.txt --format yaml
pnpm dev model -f input.txt --format mermaid
```

## Commands

### Build

| Command                            | Description                                        |
| ---------------------------------- | -------------------------------------------------- |
| `swm model [input]`                | Build a world model from text, file, URL, or stdin |
| `swm model -f file -p 2`           | Multi-pass extraction (finds implicit entities)    |
| `swm refine model.json "new info"` | Incrementally refine with new input                |

### Inspect

| Command                            | Description                                       |
| ---------------------------------- | ------------------------------------------------- |
| `swm inspect model.json`           | Stats: entity counts, most connected, confidence  |
| `swm inspect model.json -e "User"` | Look up entity with all relations and constraints |
| `swm validate model.json`          | Full integrity check with issue codes             |
| `swm query model.json "question"`  | Ask questions (graph queries + LLM inference)     |
| `swm schema`                       | Output WorldModel JSON Schema (draft-2020-12)     |

### Compose

| Command                           | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `swm merge a.json b.json`         | Union two models (deduplicates entities)        |
| `swm diff before.json after.json` | What changed between two models                 |
| `swm intersect a.json b.json`     | Entities shared by both models                  |
| `swm subtract a.json b.json`      | Entities in A but not in B                      |
| `swm overlay base.json lens.json` | Apply constraints/relations from lens onto base |

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

| Command                | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `swm serve model.json` | Start an MCP server — any AI agent gets instant domain expertise |

Tools served: `get_entity`, `get_relations`, `find_path`, `get_process`, `check_constraint`, `query`, `get_stats`, `get_diagram`

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

Each entity carries optional `confidence` (0-1) and `properties`. The schema is available as JSON Schema via `swm schema`.

## Programmatic API

```typescript
import {
  buildWorldModel,
  queryWorldModel,
  mergeWorldModels,
  diffWorldModels,
  intersection,
  difference,
  overlay,
  toClaudeMd,
  toSystemPrompt,
  toMcpSchema,
  getWorldModelJsonSchema,
  refineWorldModel,
  findEntity,
  findDependents,
  pathsBetween,
  toMermaid,
  toDot,
  getStats,
  createTimeline,
  addSnapshot,
  entityHistory,
} from "structured-world-model";

// Build
const result = await buildWorldModel(
  {
    raw: "your input",
    sourceType: "text",
  },
  { passes: 2 },
);

// Query
const answer = await queryWorldModel(
  result.worldModel,
  "what depends on the database?",
);

// Compose
const merged = mergeWorldModels(modelA, modelB);
const shared = intersection(modelA, modelB);
const governed = overlay(baseModel, permissionsModel);

// Export
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

## Tests

```bash
pnpm test          # 216 unit tests (no LLM calls)
pnpm test:e2e      # 15 end-to-end proofs (requires API key)
pnpm typecheck     # TypeScript strict mode
```
