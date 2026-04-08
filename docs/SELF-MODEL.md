# SWM v1.0.0

Structured World Model system — the universal lens

> World model v0.1.0 — 26 entities, 26 relations, 5 processes, 10 constraints
> Confidence: 0.95

## Domain Entities

The system you are working with has these components:

### Systems

- **SWM System**: Main structured world model extraction system that converts any input into a complete architectural model
- **Pipeline System**: Configurable pipeline that orchestrates the multi-stage world model extraction process with callbacks and error handling
- **Chunking System**: Text chunking system that splits large inputs into LLM-compatible chunks with overlap preservation and paragraph boundaries
  - overlap_chars: 500
- **Graph Operations**: Graph analysis utilities providing dependency tracking, path finding, subgraph extraction, cluster detection, and impact analysis
- **Merge System**: World model composition system that merges, diffs, and applies algebraic operations (intersection, difference, overlay)
- **Export System**: Multi-format export system supporting Claude Markdown, system prompts, MCP schemas, and Mermaid diagrams
  - formats: 4
- **MCP Server**: Model Context Protocol server that exposes world model as live queryable tools for AI agents
  - tools: 9
- **Anthropic Claude**: External LLM service used for all extraction, validation, and inference operations with retry logic and timeout handling
  - default_model: "claude-sonnet-4-20250514"
- **Timeline System**: Version tracking system that captures model evolution over time with automatic diff computation
- **Fix System**: Auto-repair system that resolves validation issues like orphan entities, dangling references, and duplicates
- **Coverage System**: Model comparison system that measures how much of a reference model is covered by another model
- **Source Type Detector**: Heuristic system that analyzes input content to classify as text, code, document, URL, conversation, or mixed
  - types: 6
- **JSON Schema Generator**: System that converts Zod schemas to JSON Schema for validation and code generation

### Actors

- **CLI Interface**: Command-line interface that provides 30+ commands for building, inspecting, querying, and manipulating world models
  - commands: 30
- **Extraction Agent**: LLM-powered agent that analyzes raw input and extracts entities, relations, processes, and constraints using source-specific prompts
  - chunk_size: 80000
- **Structuring Agent**: Agent that converts raw extraction output into valid WorldModel schema, handling ID generation and entity deduplication
- **Validation Agent**: Comprehensive validation system that checks model integrity, detects orphans, cycles, and computes quality scores 0-100
  - max_score: 100
- **Second Pass Agent**: Completeness agent that finds implicit entities and relations missed by the first extraction pass
- **Refinement Agent**: Incremental extraction agent that updates existing models with new input while preserving existing knowledge
- **Query Agent**: Natural language query system with 10 graph patterns for deterministic queries plus LLM fallback for open-ended questions
  - patterns: 10
- **Transform Agent**: Agent that applies natural language transformations to world models, adding/removing/modifying elements

### Concepts

- **WorldModel Schema**: Zod-based schema defining entities, relations, processes, constraints with 8 entity types and 17 relation types
  - entity_types: 8
  - relation_types: 17
- **Entity**: Core model element representing actors, objects, systems, concepts, locations, events, groups, or resources
  - types: 8
- **Relation**: Directed edge between entities with semantic types like depends_on, uses, produces, controls
  - types: 17
- **Process**: Dynamic sequence with ordered steps, participants, triggers, and outcomes representing workflows
- **Constraint**: Invariant or rule with hard/soft severity that must hold true for specific entities
  - severities: 2

## Relationships

These are the dependencies and connections between components:

- **CLI Interface** controls **SWM System**: provides command-line access to all system functionality
- **Pipeline System** uses **Extraction Agent**: orchestrates extraction stage
- **Pipeline System** uses **Structuring Agent**: orchestrates structuring stage
- **Pipeline System** uses **Validation Agent**: orchestrates validation stage
- **Extraction Agent** uses **Chunking System**: chunks large inputs before processing
- **Extraction Agent** uses **Source Type Detector**: gets source-specific prompts
- **Extraction Agent** uses **Anthropic Claude**: calls LLM for extraction
- **Structuring Agent** uses **WorldModel Schema**: validates output against schema
- **Validation Agent** uses **Graph Operations**: analyzes model integrity
- **Second Pass Agent** uses **Anthropic Claude**: finds implicit elements
- **Refinement Agent** uses **Merge System**: merges new extractions with existing model
- **Query Agent** uses **Graph Operations**: performs deterministic graph queries
- **Query Agent** uses **Anthropic Claude**: handles open-ended inference queries
- **Transform Agent** uses **Merge System**: applies transformations via merging
- **MCP Server** uses **Query Agent**: exposes query functionality as tools
- **MCP Server** uses **Graph Operations**: exposes graph analysis as tools
- **Export System** uses **Graph Operations**: generates Mermaid diagrams
- **Timeline System** uses **Merge System**: computes diffs between snapshots
- **Fix System** uses **Validation Agent**: identifies issues to repair
- **Coverage System** uses **Graph Operations**: analyzes model similarity
- **SWM System** produces **WorldModel Schema**: generates structured world models
- **WorldModel Schema** contains **Entity**: defines entity structure
- **WorldModel Schema** contains **Relation**: defines relation structure
- **WorldModel Schema** contains **Process**: defines process structure
- **WorldModel Schema** contains **Constraint**: defines constraint structure
- **JSON Schema Generator** transforms **WorldModel Schema**: converts Zod to JSON Schema

## Processes

When these events occur, follow these sequences:

### World Model Extraction

Multi-stage pipeline that converts raw input into structured world model
**Trigger:** User provides input text, code, or document

1. **Source Type Detector**: Detect source type and chunk large inputs
2. **Extraction Agent**: Extract entities, relations, processes, constraints using LLM
3. **Structuring Agent**: Convert to valid schema with ID generation and deduplication
4. **Validation Agent**: Validate integrity and compute quality score

**Outcomes:** Complete structured world model with validation report

### Multi-Pass Extraction

Enhanced extraction with second pass to find implicit elements
**Trigger:** User requests deeper analysis with --passes 2+

1. **Pipeline System**: Run standard extraction pipeline
2. **Second Pass Agent**: Analyze first pass results and find missing implicit elements
3. **Merge System**: Merge delta with existing model
4. **Validation Agent**: Final validation of merged result

**Outcomes:** More complete world model with inferred elements

### Model Query

Process natural language questions about world model
**Trigger:** User asks question about model

1. **Query Agent**: Try deterministic graph pattern matching
2. **Query Agent**: If no pattern match, use LLM inference
3. **Query Agent**: Extract referenced entities from answer

**Outcomes:** Natural language answer with method and confidence

### Model Merge

Combine two world models into unified representation
**Trigger:** User requests merge of two models

1. **Merge System**: Deduplicate entities by normalized name
2. **Merge System**: Remap all IDs and merge relations/processes/constraints
3. **Validation Agent**: Validate merged result

**Outcomes:** Single unified world model

### MCP Service

Serve world model as live queryable tools for AI agents
**Trigger:** User starts MCP server

1. **MCP Server**: Load world model from file
2. **MCP Server**: Register 9 tools for entity lookup, relations, queries, etc.
3. **MCP Server**: Listen for tool calls and route to appropriate handlers

**Outcomes:** Live AI-queryable domain expertise

## Constraints

You MUST respect these rules at all times:

### Hard Constraints (violations are errors)

- **LLM Dependency** (applies to: Extraction Agent, Query Agent, Second Pass Agent, Refinement Agent, Transform Agent): System requires ANTHROPIC_API_KEY and network access to function
- **Schema Validation** (applies to: WorldModel Schema, Structuring Agent, Validation Agent): All world models must conform to WorldModel Zod schema
- **Entity Reference Integrity** (applies to: Relation, Entity): All relation source/target IDs must reference existing entities
- **Chunk Size Limit** (applies to: Chunking System, Extraction Agent): Individual chunks cannot exceed 80,000 tokens for LLM processing
- **Quality Score Range** (applies to: Validation Agent): Quality scores must be between 0-100
- **Confidence Range** (applies to: Entity, Extraction Agent): Entity and extraction confidence values must be between 0.0-1.0
- **MCP Tool Limit** (applies to: MCP Server): MCP server exposes exactly 9 predefined tools

### Soft Constraints (violations are warnings)

- **Process Step Ordering** (applies to: Process): Process steps should be in ascending order
- **Entity Name Uniqueness** (applies to: Entity): Entity names should be unique within a model to avoid confusion
- **Multi-Pass Limit** (applies to: Pipeline System): Maximum 3 extraction passes to prevent excessive processing

## Notes

The following observations were made during model extraction:

- Extracted from comprehensive TypeScript codebase showing sophisticated multi-agent architecture
- System demonstrates clear separation of concerns with specialized agents for each phase
- Strong emphasis on validation, quality scoring, and error recovery
- Extensible design supports multiple input types and output formats
- MCP integration enables AI agent interoperability
