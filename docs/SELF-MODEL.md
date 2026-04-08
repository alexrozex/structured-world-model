# SWM Architecture

Structured World Model extraction system architecture with multi-agent pipeline, validation, and rich tooling ecosystem

> World model v0.1.0 — 60 entities, 40 relations, 6 processes, 12 constraints
> Confidence: 0.95

## Domain Entities

The system you are working with has these components:

### Systems

- **Chunker Agent**: Splits large input text into smaller chunks that fit within LLM context limits
  - maxTokens: 80000
  - overlapChars: 500
- **Extraction Agent**: Analyzes input and extracts structured world model elements using LLM inference
  - systemPrompt: "specialized"
  - multiPass: true
- **Structuring Agent**: Converts raw extraction output into validated WorldModel schema format
  - normalizesTypes: true
  - deduplicatesEntities: true
- **Validation Agent**: Validates world model integrity and computes quality scores
  - checksReferences: true
  - detectsCircularDeps: true
- **Second Pass Agent**: Finds implicit entities and relations missed in initial extraction
  - confidenceRange: [0.3,0.7]
- **Refinement Agent**: Incrementally updates existing world models with new input
  - detectsContradictions: true
- **Query Agent**: Answers natural language questions about world models using graph analysis and LLM inference
  - graphPatterns: "deterministic"
  - fallbackMode: "llm"
- **Transform Agent**: Applies natural language transformations to modify world models
  - supportsRemovals: true
  - supportsAdditions: true
- **Pipeline System**: Orchestrates multi-stage processing with progress callbacks and error handling
  - configurable: true
  - observable: true
- **LLM Client**: Anthropic Claude API client with retry logic and timeout handling
  - defaultModel: "claude-sonnet-4-20250514"
  - maxRetries: 3
- **Source Type Detection**: Automatically determines input type from content patterns and file extensions
  - supportedTypes: ["text","code","document","url","conversation","mixed"]
- **Graph Analysis Utils**: Graph algorithms for finding paths, dependencies, clusters, and impact analysis
  - bfsTraversal: true
  - connectedComponents: true
- **Merge System**: Combines multiple world models with entity deduplication and ID remapping
  - normalizeNames: true
  - preserveProperties: true
- **Export System**: Converts world models to various formats including Claude MD, system prompts, and MCP schemas
  - formats: ["claude-md","system-prompt","mcp","mermaid","dot"]
- **MCP Server**: Model Context Protocol server that exposes world models as live queryable tools
  - stdio: true
  - toolsCount: 8
- **Timeline System**: Tracks evolution of world models over time with automatic diffing
  - snapshotBased: true
  - entityHistory: true
- **Algebra Operations**: Set operations on world models including intersection, difference, and overlay
  - intersection: true
  - difference: true
  - overlay: true
- **Coverage Analysis**: Measures how completely one world model covers another
  - weightedScoring: true
  - missingElements: true
- **Fix System**: Automatically repairs common validation issues in world models
  - removeOrphans: true
  - deduplicateEntities: true
  - fixReferences: true
- **Prompt System**: Source-type specific prompts that guide extraction behavior
  - promptTypes: 6
  - baseSchema: "shared"
- **URL Fetcher**: Fetches and cleans web content, stripping HTML for better extraction
  - timeout: 30000
  - stripHtml: true
- **JSON Schema Generator**: Exports Zod schemas as JSON Schema for external tool integration
  - target: "draft-2020-12"

### Concepts

- **World Model Schema**: Zod-based type system defining entities, relations, processes, and constraints
  - enforceEnums: true
  - jsonSchemaExport: true
- **Entity**: Core domain object representing actors, systems, concepts, locations, events, groups, objects, or resources
  - hasId: true
  - hasType: true
  - hasDescription: true
- **Relation**: Directed connection between entities with semantic type and label
  - relationTypes: 17
  - bidirectional: "optional"
- **Process**: Sequential workflow with steps, participants, and outcomes
  - hasSteps: true
  - hasParticipants: true
  - orderedSteps: true
- **Constraint**: Invariant or rule that must hold true, with hard or soft severity
  - constraintTypes: 7
  - severityLevels: 2

### Actors

- **CLI Interface**: Commander.js-based command line interface providing access to all system functionality
  - commands: 30
  - watchMode: true

### Objects

- **raw input**: Auto-created entity for unresolved reference: raw input
- **source type**: Auto-created entity for unresolved reference: source type
- **text chunks**: Auto-created entity for unresolved reference: text chunks
- **raw extraction**: Auto-created entity for unresolved reference: raw extraction
- **world model**: Auto-created entity for unresolved reference: world model
- **validated model**: Auto-created entity for unresolved reference: validated model
- **issues**: Auto-created entity for unresolved reference: issues
- **score**: Auto-created entity for unresolved reference: score
- **original input**: Auto-created entity for unresolved reference: original input
- **delta extraction**: Auto-created entity for unresolved reference: delta extraction
- **delta model**: Auto-created entity for unresolved reference: delta model
- **enhanced model**: Auto-created entity for unresolved reference: enhanced model
- **final model**: Auto-created entity for unresolved reference: final model
- **question**: Auto-created entity for unresolved reference: question
- **graph result or null**: Auto-created entity for unresolved reference: graph result or null
- **model context**: Auto-created entity for unresolved reference: model context
- **inference result**: Auto-created entity for unresolved reference: inference result
- **result**: Auto-created entity for unresolved reference: result
- **formatted answer**: Auto-created entity for unresolved reference: formatted answer
- **existing model**: Auto-created entity for unresolved reference: existing model
- **new input**: Auto-created entity for unresolved reference: new input
- **updated model**: Auto-created entity for unresolved reference: updated model
- **refined model**: Auto-created entity for unresolved reference: refined model
- **instruction**: Auto-created entity for unresolved reference: instruction
- **current model**: Auto-created entity for unresolved reference: current model
- **change specification**: Auto-created entity for unresolved reference: change specification
- **transformation delta**: Auto-created entity for unresolved reference: transformation delta
- **transformed model**: Auto-created entity for unresolved reference: transformed model
- **format type**: Auto-created entity for unresolved reference: format type
- **formatter**: Auto-created entity for unresolved reference: formatter
- **formatted output**: Auto-created entity for unresolved reference: formatted output
- **exported file**: Auto-created entity for unresolved reference: exported file

## Relationships

These are the dependencies and connections between components:

- **CLI Interface** uses **Pipeline System**: orchestrates extraction through
- **Pipeline System** contains **Extraction Agent**: first stage processes input with
- **Pipeline System** contains **Structuring Agent**: second stage structures output with
- **Pipeline System** contains **Validation Agent**: third stage validates with
- **Extraction Agent** uses **Chunker Agent**: splits large input using
- **Extraction Agent** uses **LLM Client**: calls language model through
- **Extraction Agent** uses **Prompt System**: gets specialized prompts from
- **Structuring Agent** uses **World Model Schema**: validates against
- **Validation Agent** uses **World Model Schema**: enforces integrity rules from
- **Query Agent** uses **Graph Analysis Utils**: performs deterministic queries with
- **Query Agent** uses **LLM Client**: falls back to inference through
- **Refinement Agent** uses **Extraction Agent**: extracts deltas using
- **Refinement Agent** uses **Merge System**: combines models with
- **Second Pass Agent** uses **LLM Client**: finds implicit elements through
- **Transform Agent** uses **LLM Client**: applies transformations through
- **Transform Agent** uses **Merge System**: merges changes using
- **CLI Interface** uses **Source Type Detection**: automatically determines input type with
- **CLI Interface** uses **URL Fetcher**: fetches web content through
- **CLI Interface** uses **Query Agent**: answers questions through
- **CLI Interface** uses **Graph Analysis Utils**: performs analysis with
- **CLI Interface** uses **Export System**: exports models through
- **CLI Interface** uses **Timeline System**: tracks evolution with
- **CLI Interface** uses **Algebra Operations**: performs set operations with
- **CLI Interface** uses **Coverage Analysis**: measures coverage with
- **CLI Interface** uses **Fix System**: repairs issues with
- **MCP Server** uses **Query Agent**: serves queries through
- **MCP Server** uses **Graph Analysis Utils**: provides tools using
- **World Model Schema** contains **Entity**: defines structure for
- **World Model Schema** contains **Relation**: defines structure for
- **World Model Schema** contains **Process**: defines structure for
- **World Model Schema** contains **Constraint**: defines structure for
- **Entity** flows to **Relation**: connected by
- **Entity** flows to **Process**: participates in
- **Entity** flows to **Constraint**: scoped by
- **Chunker Agent** uses **LLM Client**: estimates tokens through
- **Export System** uses **JSON Schema Generator**: generates schemas with
- **Timeline System** uses **Merge System**: computes diffs using
- **Fix System** uses **World Model Schema**: repairs according to
- **Merge System** produces **World Model Schema**: creates valid instances of
- **Algebra Operations** produces **World Model Schema**: creates valid instances of

## Processes

When these events occur, follow these sequences:

### World Model Extraction

Complete pipeline from raw input to validated world model
**Trigger:** User provides input text, code, or document

1. **Source Type Detection**: Detect input source type from content patterns
2. **Chunker Agent**: Chunk input if it exceeds token limits
3. **Extraction Agent**: Extract entities, relations, processes, and constraints
4. **Structuring Agent**: Structure extraction into validated schema format
5. **Validation Agent**: Validate integrity and compute quality score

**Outcomes:** Structured world model with quality assessment

### Multi-Pass Enhancement

Optional second pass to find implicit elements
**Trigger:** User requests multiple extraction passes

1. **Second Pass Agent**: Analyze existing model for gaps
2. **Structuring Agent**: Structure delta into model format
3. **Merge System**: Merge delta with existing model
4. **Validation Agent**: Re-validate merged model

**Outcomes:** Enhanced world model with implicit elements

### World Model Querying

Answer questions about world model content
**Trigger:** User asks natural language question

1. **Query Agent**: Try deterministic graph pattern matching
2. **Query Agent**: If no pattern matches, use LLM inference
3. **Query Agent**: Format response with confidence and method

**Outcomes:** Natural language answer with confidence score

### Model Refinement

Incrementally update existing model with new information
**Trigger:** User provides new input for existing model

1. **Refinement Agent**: Extract only new or changed elements
2. **Structuring Agent**: Structure delta into model format
3. **Merge System**: Merge delta with existing model
4. **Validation Agent**: Validate updated model

**Outcomes:** Updated world model with new information integrated

### Model Transformation

Apply natural language changes to world model
**Trigger:** User provides transformation instruction

1. **Transform Agent**: Analyze transformation requirements
2. **Transform Agent**: Generate entities/relations to add or modify
3. **Transform Agent**: Apply changes to model
4. **Validation Agent**: Re-validate transformed model

**Outcomes:** Modified world model reflecting requested changes

### Model Export

Convert world model to external formats
**Trigger:** User requests specific export format

1. **Export System**: Select appropriate export formatter
2. **Export System**: Transform model to target format
3. **CLI Interface**: Write to file or stdout

**Outcomes:** World model in requested format for external consumption

## Constraints

You MUST respect these rules at all times:

### Hard Constraints (violations are errors)

- **Token Limit Constraint** (applies to: Chunker Agent, LLM Client): Input chunks must not exceed 80,000 tokens to fit in LLM context window
- **Schema Validation** (applies to: World Model Schema, Structuring Agent, Validation Agent): All world models must conform to the defined Zod schema structure
- **Entity Reference Integrity** (applies to: Relation, Process, Validation Agent): All relation sources/targets and process participants must reference valid entity IDs
- **Unique Entity IDs** (applies to: Entity, Structuring Agent): Each entity within a world model must have a unique identifier
- **Retry Limit** (applies to: LLM Client): LLM API calls are limited to 3 retry attempts with exponential backoff
- **Quality Score Range** (applies to: Validation Agent): Model quality scores must be between 0 and 100
- **Confidence Score Range** (applies to: Entity, World Model Schema): All confidence scores must be between 0.0 and 1.0
- **API Timeout** (applies to: LLM Client): LLM API calls must complete within 2 minutes

### Soft Constraints (violations are warnings)

- **Process Step Ordering** (applies to: Process, Fix System): Process steps should be ordered sequentially without gaps or duplicates
- **Entity Name Deduplication** (applies to: Merge System, Structuring Agent): Entities with identical normalized names should be merged during model combination
- **Circular Dependency Detection** (applies to: Validation Agent, Graph Analysis Utils): Models should not contain circular dependencies between entities
- **Non-Empty Extraction** (applies to: Extraction Agent): Extractions should contain at least one entity or relation to be considered valid

## Notes

The following observations were made during model extraction:

- Identified comprehensive multi-agent architecture with clear separation of concerns
- System supports multiple input types and provides extensive CLI and programmatic interfaces
- Strong validation and quality assurance throughout pipeline
- Rich ecosystem of analysis, comparison, and export tools
- MCP server integration enables live AI assistant interaction
- Timeline and versioning support for model evolution tracking
- Mathematical operations (algebra) on world models enable composition workflows
