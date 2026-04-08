# Structured World Model (SWM) System Architecture

Complete architecture of a TypeScript system for extracting, structuring, and manipulating world models from arbitrary input using LLM-based agents and graph operations

> World model v0.1.0 — 30 entities, 36 relations, 5 processes, 10 constraints
> Confidence: 0.95

## Domain Entities

The system you are working with has these components:

### Actors

- **Chunker Agent**: Agent responsible for splitting large text inputs into manageable chunks that fit within LLM context limits
  - max_chunk_tokens: 80000
  - overlap_chars: 500
- **Extraction Agent**: Core agent that analyzes input and extracts structured world models using LLM calls
- **Structuring Agent**: Agent that converts raw extraction output into properly structured world model format with normalized types and ID mapping
- **Validation Agent**: Agent that validates world model integrity, checking for dangling references and structural issues
- **Second Pass Agent**: Agent that performs completeness analysis to find implicit entities and relations missed in the first extraction pass
- **Refinement Agent**: Agent that incrementally refines existing world models with new input, extracting only delta changes
- **Query Agent**: Agent that answers natural language questions about world models using deterministic graph queries or LLM inference

### Systems

- **Pipeline**: Orchestration system that manages the sequential execution of processing stages with timing and callback support
- **CLI Interface**: Command-line interface providing commands for modeling, validation, querying, and manipulation operations
- **LLM Client**: Anthropic Claude client with retry logic, timeout handling, and JSON parsing capabilities
- **Graph Utils**: Graph analysis utilities for entity lookup, dependency finding, path discovery, and format export
- **Merge System**: System for merging multiple world models with entity deduplication and ID remapping
- **Timeline System**: Version control system for tracking world model evolution across snapshots with diff computation
- **Export System**: Multi-format export system supporting Claude MD, system prompts, MCP schemas, Mermaid, and DOT formats
- **Algebra Operations**: Set algebra operations for world models including intersection, difference, and overlay functions
- **Schema Validation**: Zod-based schema validation system for raw extractions and world model structures
- **ID Generator**: Cryptographic random ID generation system using prefixes for different entity types

### Concepts

- **World Model**: Core data structure representing entities, relations, processes, and constraints extracted from input
- **Entity**: Fundamental building block representing actors, objects, systems, concepts, locations, events, groups, or resources
- **Relation**: Directed connection between entities with semantic type and optional bidirectionality
- **Process**: Dynamic sequence of ordered steps with participants, triggers, and outcomes
- **Constraint**: Rule or invariant that applies to entities with hard or soft severity levels

### Resources

- **Input Text**: Raw input text to be processed, classified by source type (text, code, document, url, conversation, mixed)

### Objects

- **Chunk**: Individual text segment with index, total count, content, and token estimate
- **Raw Extraction**: Unstructured extraction output from LLM containing arrays of entities, relations, processes, and constraints
- **Validation Result**: Validation outcome containing validity status, issues list, and statistical summary
- **Query Result**: Query response containing answer, method used, referenced entities, and confidence score
- **Timeline**: Version history container holding ordered snapshots of world model evolution
- **Snapshot**: Point-in-time world model state with timestamp, diff from previous, and statistics
- **Diff**: Comparison result showing added, removed, and modified elements between world model versions

## Relationships

These are the dependencies and connections between components:

- **Extraction Agent** uses **Chunker Agent**: splits large inputs into processable chunks
- **Extraction Agent** uses **LLM Client**: calls LLM for world model extraction
- **Extraction Agent** produces **Raw Extraction**: generates unstructured extraction output
- **Structuring Agent** consumes **Raw Extraction**: processes raw extraction into structured format
- **Structuring Agent** produces **World Model**: creates structured world model with normalized types and IDs
- **Validation Agent** consumes **World Model**: validates world model integrity
- **Validation Agent** produces **Validation Result**: generates validation outcome with issues and stats
- **Pipeline** contains **Extraction Agent**: orchestrates extraction stage execution
- **Pipeline** contains **Structuring Agent**: orchestrates structuring stage execution
- **Pipeline** contains **Validation Agent**: orchestrates validation stage execution
- **World Model** contains **Entity**: composed of entity instances
- **World Model** contains **Relation**: composed of relation instances
- **World Model** contains **Process**: composed of process instances
- **World Model** contains **Constraint**: composed of constraint instances
- **Relation** depends on **Entity**: references source and target entities by ID
- **Process** depends on **Entity**: references participant entities and step actors
- **Constraint** depends on **Entity**: applies to entities in scope array
- **CLI Interface** uses **Pipeline**: executes world model building pipeline
- **CLI Interface** uses **Query Agent**: processes query commands
- **CLI Interface** uses **Export System**: exports world models in various formats
- **Query Agent** uses **Graph Utils**: performs deterministic graph queries
- **Query Agent** uses **LLM Client**: performs inference queries when graph patterns don't match
- **Query Agent** produces **Query Result**: generates query responses with answers and metadata
- **Refinement Agent** uses **Merge System**: merges existing models with delta changes
- **Second Pass Agent** consumes **World Model**: analyzes existing model to find gaps
- **Second Pass Agent** produces **Raw Extraction**: extracts implicit entities and relations
- **Timeline System** contains **Snapshot**: maintains ordered collection of snapshots
- **Snapshot** contains **World Model**: preserves point-in-time model state
- **Snapshot** contains **Diff**: includes diff from previous snapshot
- **Schema Validation** uses **Raw Extraction**: validates and coerces LLM extraction output
- **Chunker Agent** produces **Chunk**: splits text into manageable chunks
- **Chunker Agent** consumes **Input Text**: processes raw input text
- **ID Generator** produces **Entity**: generates unique entity IDs
- **ID Generator** produces **Relation**: generates unique relation IDs
- **ID Generator** produces **Process**: generates unique process IDs
- **ID Generator** produces **Constraint**: generates unique constraint IDs

## Processes

When these events occur, follow these sequences:

### World Model Extraction

Multi-stage pipeline that converts raw input into structured world model
**Trigger:** User provides input text with source type

1. **Chunker Agent**: Check input size and split into chunks if needed
2. **Extraction Agent**: Extract entities, relations, processes, and constraints from each chunk
3. **Extraction Agent**: Merge raw extractions from multiple chunks if applicable
4. **Structuring Agent**: Convert raw extraction to structured world model with ID mapping
5. **Validation Agent**: Validate world model integrity and generate issues report

**Outcomes:** Structured world model, Validation report, Processing statistics

### Multi-Pass Extraction

Enhanced extraction process with additional passes to capture implicit information
**Trigger:** User requests multiple extraction passes

1. **Pipeline**: Execute standard extraction pipeline
2. **Second Pass Agent**: Analyze model for implicit entities and missing relations
3. **Structuring Agent**: Structure delta extraction into world model format
4. **Merge System**: Merge original model with delta model
5. **Validation Agent**: Validate final merged model

**Outcomes:** Enhanced world model, Improved completeness, Additional implicit information

### World Model Query

Natural language query processing against world models using graph patterns or LLM inference
**Trigger:** User asks question about world model

1. **Query Agent**: Parse query against deterministic graph patterns
2. **Query Agent**: Fall back to LLM inference if no pattern matches
3. **Query Agent**: Extract referenced entities from response

**Outcomes:** Natural language answer, Method used (graph vs inference), Confidence score

### Incremental Refinement

Update existing world model with new input while preserving existing structure
**Trigger:** User provides new input to refine existing model

1. **Refinement Agent**: Summarize existing world model for context
2. **Refinement Agent**: Extract only delta changes from new input
3. **Structuring Agent**: Structure delta extraction into world model
4. **Merge System**: Merge existing model with delta model
5. **Validation Agent**: Validate merged result

**Outcomes:** Updated world model, Delta model, Merge statistics

### Timeline Management

Version control for world model evolution with snapshot management and history tracking
**Trigger:** User adds snapshot to timeline

1. **Timeline System**: Create snapshot from current world model
2. **Timeline System**: Compute diff from previous snapshot if exists
3. **Timeline System**: Add snapshot to timeline with metadata

**Outcomes:** Updated timeline, Snapshot with diff, Evolution tracking

## Constraints

You MUST respect these rules at all times:

### Hard Constraints (violations are errors)

- **Entity ID Uniqueness** (applies to: World Model, Entity): All entity IDs within a world model must be unique
- **Relation Reference Integrity** (applies to: Relation, Entity): Relations must reference existing entity IDs for both source and target
- **Process Participant Validity** (applies to: Process, Entity): Process participants and step actors must reference existing entity IDs
- **Constraint Scope Validity** (applies to: Constraint, Entity): Constraint scope arrays must reference existing entity IDs
- **Chunk Size Limit** (applies to: Chunk, Chunker Agent): Individual chunks must not exceed maximum token limit for LLM processing
- **LLM Response Timeout** (applies to: LLM Client): LLM calls must complete within configured timeout period
- **CLI Input Validation** (applies to: CLI Interface): CLI commands must receive valid input parameters and file paths
- **Schema Compliance** (applies to: Schema Validation, World Model, Raw Extraction): All data structures must comply with their respective Zod schemas

### Soft Constraints (violations are warnings)

- **Entity Name Consistency** (applies to: Entity, Merge System): Entity names should be consistent across merges and not contain only whitespace
- **Confidence Score Range** (applies to: World Model, Raw Extraction, Query Result): All confidence scores must be between 0.0 and 1.0 inclusive

## Notes

The following observations were made during model extraction:

- Extracted architectural components from TypeScript modules focusing on data flow and system interactions
- Identified agent-based processing pipeline with clear stage dependencies
- Captured world model schema with entities, relations, processes, and constraints as core concepts
- Mapped CLI command structure to underlying system operations
- Noted comprehensive utility systems for graph operations, merging, timeline management, and export formats
- System shows sophisticated retry logic, validation, and error handling throughout
