# SWM System Architecture

A comprehensive TypeScript system for extracting, structuring, analyzing, and serving world models from diverse inputs using LLM agents and graph analysis

> World model v0.1.0 — 27 entities, 31 relations, 4 processes, 8 constraints
> Confidence: 0.9

## Domain Entities

The system you are working with has these components:

### Systems

- **CLI Interface**: Command-line interface providing 20+ commands for building, inspecting, merging, and transforming world models
  - commands: 20
- **Pipeline System**: Orchestrates the multi-stage world model extraction process with callbacks and progress tracking
- **Chunker Module**: Splits large inputs into token-sized chunks with paragraph-boundary awareness and overlap
  - max_tokens: 80000
  - overlap_chars: 500
- **LLM Client**: Anthropic Claude API client with retry logic, timeout handling, and token estimation
  - default_model: "claude-sonnet-4-20250514"
- **Graph Analysis Module**: Provides pathfinding, dependency analysis, impact analysis, clustering, and subgraph extraction
- **MCP Server**: Model Context Protocol server exposing world model as 9 live queryable tools for AI agents
  - tools: 9
- **Export System**: Converts world models to Claude MD, system prompts, MCP schemas, Mermaid diagrams, and DOT graphs
- **Timeline System**: Tracks world model evolution over time with snapshots and automatic diffing
- **Merge System**: Combines multiple world models with entity deduplication and ID remapping
- **Fix System**: Auto-repairs world model validation issues like orphan entities and dangling references

### Actors

- **Extraction Agent**: LLM-powered agent that analyzes raw input and extracts entities, relations, processes, and constraints
- **Structuring Agent**: Agent that converts raw LLM extractions into properly structured world models with normalized types and IDs
- **Validation Agent**: Agent that performs integrity checks on world models, detecting orphans, dangling references, and circular dependencies
- **Second Pass Agent**: Agent that finds implicit entities and relations missed in the first extraction pass
- **Query Agent**: Agent that answers natural language questions about world models using graph patterns and LLM inference
- **Refinement Agent**: Agent that incrementally updates existing world models with new input
- **Transform Agent**: Agent that applies natural language transformations to modify world models

### Concepts

- **World Model Schema**: Zod-based schema defining entities, relations, processes, constraints with validation
- **Entity**: Core domain object representing actors, systems, concepts, locations, events, groups, objects, or resources
- **Relation**: Directed connection between entities with semantic types like depends_on, uses, contains
- **Process**: Dynamic sequence of ordered steps with actors, triggers, and outcomes
- **Constraint**: Invariant rule that must hold true, with hard or soft severity

### Resources

- **Prompt Templates**: Specialized extraction prompts for different source types (text, code, conversation, document, URL)
- **File Input**: Text files, code files, JSON, YAML, CSV, and other document formats
- **URL Input**: Web pages fetched and stripped of HTML for content extraction

### Objects

- **Validation Result**: Comprehensive validation report with issues, stats, and quality scores
- **Query Result**: Answer to natural language questions with method, confidence, and referenced entities

## Relationships

These are the dependencies and connections between components:

- **CLI Interface** uses **Pipeline System**: orchestrates extraction via
- **Pipeline System** contains **Extraction Agent**: first stage runs
- **Pipeline System** contains **Structuring Agent**: second stage runs
- **Pipeline System** contains **Validation Agent**: final stage runs
- **Extraction Agent** uses **LLM Client**: calls Claude API via
- **Extraction Agent** uses **Chunker Module**: splits large input with
- **Extraction Agent** uses **Prompt Templates**: selects specialized prompts from
- **Structuring Agent** uses **World Model Schema**: validates against
- **Validation Agent** uses **Graph Analysis Module**: detects issues via
- **Second Pass Agent** uses **LLM Client**: finds implicit elements via
- **Query Agent** uses **Graph Analysis Module**: answers structural questions via
- **Query Agent** uses **LLM Client**: handles open-ended questions via
- **Refinement Agent** uses **Merge System**: combines models via
- **Transform Agent** uses **LLM Client**: applies transformations via
- **MCP Server** uses **Graph Analysis Module**: exposes tools backed by
- **MCP Server** uses **Query Agent**: provides query tool via
- **Export System** uses **Graph Analysis Module**: generates diagrams via
- **Timeline System** uses **Merge System**: computes diffs via
- **Fix System** uses **Validation Agent**: repairs issues identified by
- **CLI Interface** consumes **File Input**: reads various formats from
- **CLI Interface** consumes **URL Input**: fetches and processes
- **World Model Schema** contains **Entity**: defines structure of
- **World Model Schema** contains **Relation**: defines structure of
- **World Model Schema** contains **Process**: defines structure of
- **World Model Schema** contains **Constraint**: defines structure of
- **Validation Agent** produces **Validation Result**: generates detailed
- **Query Agent** produces **Query Result**: returns structured
- **Entity** flows to **Relation**: connected by
- **Process** uses **Entity**: involves multiple
- **Constraint** controls **Entity**: applies rules to
- **Chunker Module** depends on **LLM Client**: uses token limits from

## Processes

When these events occur, follow these sequences:

### World Model Extraction

Complete pipeline to extract structured world models from any input type
**Trigger:** User runs swm model command with input

1. **CLI Interface**: Detect source type from file extension or content patterns
2. **Chunker Module**: Check input size and chunk if necessary
3. **Extraction Agent**: Extract entities, relations, processes, constraints using specialized prompts
4. **Structuring Agent**: Structure raw extraction into proper world model with ID generation
5. **Validation Agent**: Validate model integrity and generate quality score

**Outcomes:** Structured world model with validation report

### Multi-Pass Extraction

Enhanced extraction with multiple passes to find implicit elements
**Trigger:** User specifies passes > 1

1. **Pipeline System**: Run standard extraction pipeline
2. **Second Pass Agent**: Find implicit entities and relations missed in first pass
3. **Structuring Agent**: Structure delta extraction
4. **Merge System**: Merge original and delta models
5. **Validation Agent**: Final validation of merged result

**Outcomes:** More complete world model with implicit elements captured

### Natural Language Query

Answer questions about world models using graph patterns and LLM inference
**Trigger:** User asks question via swm query command

1. **Query Agent**: Try to match question against known graph patterns
2. **Graph Analysis Module**: If pattern matched, execute graph analysis
3. **Query Agent**: If no pattern match, use LLM inference with model context
4. **Query Agent**: Format answer with method, confidence, and referenced entities

**Outcomes:** Natural language answer with confidence and method

### MCP Tool Execution

Serve world model as live tools for AI agents via Model Context Protocol
**Trigger:** AI agent calls MCP tool

1. **MCP Server**: Parse tool call parameters
2. **Graph Analysis Module**: Execute appropriate graph analysis or query
3. **MCP Server**: Format result for AI agent consumption

**Outcomes:** Real-time domain expertise for AI agents

## Constraints

You MUST respect these rules at all times:

### Hard Constraints (violations are errors)

- **Token Limit Constraint** (applies to: Chunker Module, LLM Client): Input chunks must not exceed 80,000 tokens to fit within Claude's context window
- **Relation Reference Integrity** (applies to: Validation Agent, Fix System): All relation source and target IDs must reference existing entities
- **Schema Compliance** (applies to: Structuring Agent, World Model Schema): All world models must validate against the Zod schema
- **API Rate Limiting** (applies to: LLM Client): Claude API calls must respect rate limits with exponential backoff retry

### Soft Constraints (violations are warnings)

- **Entity Name Uniqueness** (applies to: Structuring Agent, Merge System): Entity names within a world model should be unique after normalization
- **Process Step Ordering** (applies to: Structuring Agent, Fix System): Process steps must have monotonically increasing order numbers
- **Source Type Detection** (applies to: CLI Interface, Prompt Templates): Input must be classified into one of six source types for appropriate prompt selection
- **Confidence Scoring** (applies to: Extraction Agent, Validation Agent): All extractions must include confidence scores between 0 and 1

## Notes

The following observations were made during model extraction:

- System implements sophisticated multi-pass extraction with chunk handling
- Strong emphasis on validation and auto-fixing of model integrity issues
- Provides both CLI and MCP server interfaces for different use cases
- Graph analysis capabilities include pathfinding, clustering, and impact analysis
- Export system supports multiple formats for AI consumption (Claude MD, system prompts, MCP schemas)
