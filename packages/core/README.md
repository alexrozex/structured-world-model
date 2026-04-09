# @swm/core

Turn anything into a structured, validated, queryable world model. Extract entities, relations, processes, and constraints from text, code, documents, URLs, or conversations — then serve them to AI agents via MCP.

## Quick Start

```bash
npm install @swm/core
export ANTHROPIC_API_KEY=sk-ant-...
```

### One-liner API

```typescript
import { swm } from "@swm/core";

const result = await swm(
  "A marketplace where freelancers post services and clients book them",
);

result.model; // WorldModel: entities, relations, processes, constraints
result.health; // Grade A-F with metrics
result.validation; // Score 0-100 with issues
result.exports; // claudeMd, systemPrompt, html, yaml, json, markdownTable
result.cost; // Estimated tokens and USD
```

### CLI

```bash
# Extract
swm model "A hospital with doctors, patients, and appointments"
swm model -f spec.md --passes 2
swm model https://docs.example.com/api

# Inspect
swm inspect model.json
swm explain model.json Patient
swm top model.json -n 5
swm health model.json
swm query model.json "what depends on Payment?"

# Compose
swm merge spec.json impl.json
swm diff before.json after.json
swm coverage spec.json impl.json
swm filter model.json -t actor

# Export (10 formats)
swm export model.json --as claude-md
swm export model.json --as html
swm export model.json --as yaml
swm publish model.json -o ./my-mcp-server

# Serve as MCP
swm serve model.json
```

## What it extracts

| Element         | Description                                                                                   | Example                  |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| **Entities**    | Things that exist (8 types: actor, object, system, concept, location, event, group, resource) | User, Database, Payment  |
| **Relations**   | Directed edges (17 types: uses, depends_on, triggers, produces...)                            | User uses Database       |
| **Processes**   | Ordered workflows with steps, triggers, outcomes                                              | Purchase Flow (5 steps)  |
| **Constraints** | Rules and invariants (hard/soft severity)                                                     | "Orders require payment" |

Every element carries **source_context** — a verbatim quote from the input proving its existence.

## Key features

- **Auto-fix**: Noise entities, dangling refs, and orphans cleaned automatically
- **Structured outputs**: JSON schema constrained decoding with graceful fallback
- **Prompt caching**: 90% input cost reduction on repeated extractions
- **Fuzzy coverage**: Spec-vs-implementation traceability with word-overlap matching
- **Health grades**: A-F assessment with relation density, confidence, provenance metrics
- **Cost estimation**: Preview tokens and USD before extracting
- **Model algebra**: merge, diff, intersect, subtract, overlay, filter
- **10 export formats**: CLAUDE.md, system-prompt, MCP schema, HTML, YAML, JSON, DOT, Mermaid, summary card, markdown table
- **MCP server**: Serve any world model as 10 queryable tools

## API (65+ exports)

```typescript
// Core
import { swm, buildWorldModel, Pipeline } from "@swm/core";

// Graph operations
import {
  findEntity,
  pathsBetween,
  analyzeImpact,
  findClusters,
} from "@swm/core";

// Composition
import {
  mergeWorldModels,
  diffWorldModels,
  compare,
  coverage,
  filterModel,
} from "@swm/core";

// Export
import { toClaudeMd, toSystemPrompt, toHtml, toSummaryCard } from "@swm/core";

// Utilities
import {
  assessHealth,
  estimateCost,
  parseWorldModel,
  bumpVersion,
} from "@swm/core";
```

## License

MIT
