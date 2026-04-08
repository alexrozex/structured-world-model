# Structured World Model System Architecture

TypeScript/Node.js system for extracting structured world models from any input using LLM agents, with pipeline orchestration, validation, querying, and export capabilities

> World model v0.1.0 — 57 entities, 29 relations, 5 processes, 9 constraints
> Confidence: 0.9

## Domain Entities

The system you are working with has these components:

### Systems

- **Chunker Agent**: Splits large text inputs into manageable chunks that fit within LLM context limits, preserving context at boundaries
  - max_chunk_tokens: 80000
  - overlap_chars: 500
- **Extraction Agent**: LLM-powered agent that extracts structured world models from raw input using specialized prompts for different source types
- **Structuring Agent**: Converts raw extraction data into structured WorldModel format with proper ID mapping and validation
- **Validation Agent**: Validates world model integrity by checking entity references, detecting orphans, and identifying issues
- **Refinement Agent**: Incrementally updates existing world models with new input, extracting only deltas and changes
- **Second Pass Agent**: Performs completeness analysis to find implicit entities, relations, and constraints missed in first pass
- **Query Agent**: Answers natural language questions about world models using deterministic graph operations or LLM inference
- **Pipeline**: Sequential stage execution framework with timing and progress callbacks for building world models
- **LLM Client**: Anthropic Claude integration with retry logic, timeout handling, and JSON parsing capabilities
- **Graph Utilities**: Graph traversal and analysis functions for finding paths, dependencies, and generating visualizations
- **CLI Tool**: Command-line interface providing model building, refinement, querying, and export functionality
- **Schema Validation**: Zod-based schema validation for raw extractions with coercion and error recovery
- **Export Formats**: Multiple export formats including Claude.md, system prompts, MCP schemas, Mermaid, and DOT
- **Merge Engine**: Merges multiple world models with entity deduplication, ID remapping, and conflict resolution
- **Timeline System**: Tracks world model evolution over time with snapshots, diffs, and entity history
- **Algebra Operations**: Set-theoretic operations on world models: intersection, difference, and overlay
- **Token Estimator**: Estimates token count from text input using 4-character-per-token approximation
- **ID Generator**: Generates unique identifiers with prefixes using cryptographic random bytes

### Concepts

- **World Model**: Structured representation containing entities, relations, processes, and constraints extracted from input
  - id: "string"
  - name: "string"
  - version: "string"
  - created_at: "timestamp"
- **Entity**: Something that exists in the world - actors, objects, systems, concepts, locations, events, groups, or resources
  - id: "EntityId"
  - name: "string"
  - type: "enum"
  - description: "string"
  - properties: "object"
  - tags: "array"
- **Relation**: Directed connection between two entities with semantic type and human-readable label
  - id: "RelationId"
  - type: "enum"
  - source: "EntityId"
  - target: "EntityId"
  - label: "string"
  - bidirectional: "boolean"
- **Process**: Dynamic sequence of steps that happen over time with actors, inputs, and outputs
  - id: "ProcessId"
  - name: "string"
  - description: "string"
  - trigger: "string"
  - steps: "array"
  - participants: "array"
  - outcomes: "array"
- **Constraint**: Invariant rule that must always hold true, with scope and severity level
  - id: "ConstraintId"
  - name: "string"
  - type: "enum"
  - description: "string"
  - scope: "array"
  - severity: "hard|soft"

### Resources

- **Prompt Templates**: Source-type-specific prompts for code, conversation, document, URL, and mixed content analysis

### Objects

- **raw text input**: Auto-created entity for unresolved reference: raw text input
- **text chunks**: Auto-created entity for unresolved reference: text chunks
- **source type**: Auto-created entity for unresolved reference: source type
- **raw extraction data**: Auto-created entity for unresolved reference: raw extraction data
- **structured world model**: Auto-created entity for unresolved reference: structured world model
- **validated model**: Auto-created entity for unresolved reference: validated model
- **validation issues**: Auto-created entity for unresolved reference: validation issues
- **initial world model**: Auto-created entity for unresolved reference: initial world model
- **original input**: Auto-created entity for unresolved reference: original input
- **delta extraction**: Auto-created entity for unresolved reference: delta extraction
- **delta model**: Auto-created entity for unresolved reference: delta model
- **merged model**: Auto-created entity for unresolved reference: merged model
- **final validated model**: Auto-created entity for unresolved reference: final validated model
- **existing world model**: Auto-created entity for unresolved reference: existing world model
- **model summary**: Auto-created entity for unresolved reference: model summary
- **new input**: Auto-created entity for unresolved reference: new input
- **existing model**: Auto-created entity for unresolved reference: existing model
- **updated model**: Auto-created entity for unresolved reference: updated model
- **validated updated model**: Auto-created entity for unresolved reference: validated updated model
- **question**: Auto-created entity for unresolved reference: question
- **world model**: Auto-created entity for unresolved reference: world model
- **graph result or null**: Auto-created entity for unresolved reference: graph result or null
- **model context**: Auto-created entity for unresolved reference: model context
- **inference result**: Auto-created entity for unresolved reference: inference result
- **new model**: Auto-created entity for unresolved reference: new model
- **previous snapshot**: Auto-created entity for unresolved reference: previous snapshot
- **model diff**: Auto-created entity for unresolved reference: model diff
- **diff**: Auto-created entity for unresolved reference: diff
- **label**: Auto-created entity for unresolved reference: label
- **timeline snapshot**: Auto-created entity for unresolved reference: timeline snapshot
- **timeline**: Auto-created entity for unresolved reference: timeline
- **snapshot**: Auto-created entity for unresolved reference: snapshot
- **updated timeline**: Auto-created entity for unresolved reference: updated timeline

## Relationships

These are the dependencies and connections between components:

- **Extraction Agent** uses **Chunker Agent**: splits large inputs into processable chunks
- **Extraction Agent** uses **Prompt Templates**: selects appropriate prompt based on source type
- **Extraction Agent** uses **LLM Client**: makes agent calls for structured extraction
- **Extraction Agent** uses **Schema Validation**: validates and coerces LLM output
- **Structuring Agent** produces **World Model**: converts raw extraction into structured model
- **Structuring Agent** uses **ID Generator**: generates unique IDs for all model elements
- **Validation Agent** consumes **World Model**: checks model integrity and references
- **Pipeline** contains **Extraction Agent**: orchestrates extraction stage
- **Pipeline** contains **Structuring Agent**: orchestrates structuring stage
- **Pipeline** contains **Validation Agent**: orchestrates validation stage
- **World Model** contains **Entity**: collection of domain entities
- **World Model** contains **Relation**: collection of entity relationships
- **World Model** contains **Process**: collection of dynamic sequences
- **World Model** contains **Constraint**: collection of invariant rules
- **Relation** depends on **Entity**: references source and target entities
- **Process** depends on **Entity**: references participant and actor entities
- **Constraint** depends on **Entity**: applies to entities in scope
- **Refinement Agent** uses **Merge Engine**: merges existing model with extracted delta
- **Second Pass Agent** consumes **World Model**: analyzes model for missing implicit elements
- **Query Agent** uses **Graph Utilities**: performs deterministic graph queries
- **Query Agent** uses **LLM Client**: falls back to inference for complex queries
- **CLI Tool** uses **Pipeline**: executes model building workflow
- **CLI Tool** uses **Export Formats**: outputs models in various formats
- **CLI Tool** uses **Query Agent**: provides query command functionality
- **CLI Tool** uses **Timeline System**: manages model snapshots and history
- **CLI Tool** uses **Algebra Operations**: provides intersection, difference, overlay commands
- **LLM Client** uses **Token Estimator**: estimates input size for chunking decisions
- **Chunker Agent** uses **Token Estimator**: estimates tokens to determine chunk boundaries
- **Timeline System** uses **Merge Engine**: uses diff functionality for snapshot comparison

## Processes

When these events occur, follow these sequences:

### World Model Extraction

Complete pipeline for extracting structured world models from raw input
**Trigger:** Raw input provided to buildWorldModel function

1. **Chunker Agent**: Check input size and chunk if necessary
2. **Extraction Agent**: Extract entities, relations, processes, constraints using LLM
3. **Structuring Agent**: Convert raw data to structured world model format
4. **Validation Agent**: Validate model integrity and check references

**Outcomes:** Validated world model with confidence score and extraction notes

### Multi-Pass Extraction

Enhanced extraction with multiple passes to find implicit elements
**Trigger:** passes parameter > 1 in buildWorldModel options

1. **Pipeline**: Perform standard extraction pipeline
2. **Second Pass Agent**: Analyze model for missing implicit elements
3. **Structuring Agent**: Structure delta into world model format
4. **Merge Engine**: Merge initial model with delta
5. **Validation Agent**: Final validation of merged model

**Outcomes:** Enhanced world model with implicit elements discovered

### Model Refinement

Incremental update of existing world model with new input
**Trigger:** refineWorldModel called with existing model and new input

1. **Refinement Agent**: Summarize existing model for LLM context
2. **Refinement Agent**: Extract only new/changed elements from input
3. **Structuring Agent**: Structure delta into world model
4. **Merge Engine**: Merge existing model with delta
5. **Validation Agent**: Validate merged result

**Outcomes:** Updated world model incorporating new input, Delta model showing what changed

### World Model Query

Answer natural language questions about world models
**Trigger:** queryWorldModel called with model and question

1. **Query Agent**: Try deterministic graph pattern matching
2. **Query Agent**: Fall back to LLM inference if no pattern matches

**Outcomes:** Natural language answer with confidence and method used

### Timeline Snapshot

Add world model snapshot to timeline with automatic diffing
**Trigger:** addSnapshot called or CLI snapshot command

1. **Timeline System**: Compare model with previous snapshot if exists
2. **Timeline System**: Create snapshot with metadata and diff
3. **Timeline System**: Add snapshot to timeline

**Outcomes:** Timeline with new snapshot showing evolution

## Constraints

You MUST respect these rules at all times:

### Hard Constraints (violations are errors)

- **Entity ID Consistency** (applies to: Relation, Entity): All relation source/target IDs must reference existing entity IDs
- **Process Participant Validity** (applies to: Process, Entity): All process participants and step actors must reference existing entity IDs
- **Constraint Scope Validity** (applies to: Constraint, Entity): All constraint scope entity IDs must reference existing entities
- **Chunk Size Limit** (applies to: Chunker Agent): Text chunks must not exceed MAX_CHUNK_TOKENS (80,000) to fit in LLM context
- **JSON Output Format** (applies to: Extraction Agent, Second Pass Agent, Refinement Agent): LLM agents must output valid JSON matching expected schema
- **CLI Command Authorization** (applies to: CLI Tool): CLI operations require appropriate file permissions for read/write

### Soft Constraints (violations are warnings)

- **Entity Name Uniqueness** (applies to: Entity): Entity names should be unique within a world model to avoid confusion
- **Relation Cycle Prevention** (applies to: Relation): Self-referencing relations should be flagged as warnings
- **Process Step Ordering** (applies to: Process): Process steps must have sequential order numbers

## Notes

The following observations were made during model extraction:

- System follows clean agent-based architecture with clear separation of concerns
- Heavy use of TypeScript for type safety and schema validation with Zod
- LLM integration is well-abstracted with retry logic and error handling
- CLI provides comprehensive functionality for all operations
- Export formats enable integration with various AI systems and tools
- Timeline and versioning capabilities support model evolution tracking
- Algebra operations provide advanced model manipulation capabilities
- Graph utilities enable rich querying and visualization features
