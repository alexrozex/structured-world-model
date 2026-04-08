# structured-world-model

Agentic software that turns anything you throw at it into structured world models.

Feed it text, code, conversations, documents — it extracts entities, relations, processes, and constraints into a formal, validated world model.

## Architecture

```
Input (anything) → Extraction Agent → Structuring Agent → Validation Agent → World Model
```

**Three-agent pipeline:**

1. **Extraction** — LLM-powered agent analyzes raw input, pulls out every entity, relation, process, and constraint
2. **Structuring** — Assigns IDs, resolves cross-references, builds the formal schema
3. **Validation** — Checks referential integrity, finds orphans, duplicates, and gaps

## Usage

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-...

# From text
pnpm dev model "A marketplace where sellers list products and buyers purchase them through a cart and checkout system"

# From a file
pnpm dev model -f spec.md

# From stdin
cat architecture.md | pnpm dev model

# Output as YAML
pnpm dev model -f input.txt --format yaml

# Write to file
pnpm dev model "your input" -o world-model.json

# Validate existing model
pnpm dev validate world-model.json
```

## World Model Schema

```typescript
WorldModel {
  entities:    Entity[]      // Things that exist (actors, objects, systems, concepts...)
  relations:   Relation[]    // Directed edges between entities
  processes:   Process[]     // Dynamic sequences with steps
  constraints: Constraint[]  // Rules and invariants
  metadata:    { source_type, confidence, extraction_notes }
}
```

## Install

```bash
pnpm install
pnpm build
```

## Programmatic API

```typescript
import { buildWorldModel } from "structured-world-model";

const result = await buildWorldModel({
  raw: "your input text here",
  sourceType: "text",
});

console.log(result.worldModel);
console.log(result.validation);
```
