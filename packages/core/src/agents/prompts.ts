const BASE_SCHEMA = `Output ONLY valid JSON with this EXACT structure — no other text before or after:
{
  "entities": [
    { "name": "string", "type": "actor|object|system|concept|location|event|group|resource", "description": "string", "properties": {}, "tags": ["string"] }
  ],
  "relations": [
    { "source": "entity name string", "target": "entity name string", "type": "has|is_a|part_of|depends_on|produces|consumes|controls|communicates_with|located_in|triggers|inherits|contains|uses|flows_to|opposes|enables|transforms", "label": "string", "bidirectional": false }
  ],
  "processes": [
    { "name": "string", "description": "string", "trigger": "string", "steps": [{ "order": 1, "action": "string", "actor": "entity name", "inputs": ["entity name"], "outputs": ["entity name"] }], "participants": ["entity name"], "outcomes": ["string"] }
  ],
  "constraints": [
    { "name": "string", "type": "invariant|rule|boundary|dependency|capacity|temporal|authorization", "description": "string", "scope": ["entity name"], "severity": "hard|soft" }
  ],
  "model_name": "string",
  "model_description": "string",
  "source_summary": "string",
  "confidence": 0.9,
  "extraction_notes": ["string"]
}

IMPORTANT: Every field shown as an array MUST be an array (even if empty: []). Every field shown as a string MUST be a string. Do not use any other types.

RULES:
- Entity names in relations/processes MUST exactly match entity names
- Extract EVERYTHING — be thorough, not selective
- Infer implicit entities and relations
- Output ONLY valid JSON — no commentary, no markdown, no explanation outside the JSON`;

export const PROMPTS: Record<string, string> = {
  text: `You are a world-model extraction agent. Analyze the given text and extract a complete structured world model.

Focus on:
- Named entities (people, organizations, places, things, concepts)
- Relationships between them (ownership, hierarchy, dependency, flow)
- Any described processes, workflows, or sequences of events
- Rules, constraints, limitations mentioned or implied
- Implicit entities that must exist for described behaviors to work

EXAMPLE — input: "A library lets members borrow books. Each book has an ISBN and a genre. Members can reserve books. Late returns incur a $1/day fine."

Expected extraction (abbreviated):
{
  "entities": [
    {"name": "Library", "type": "system", "description": "System that manages book lending to members"},
    {"name": "Member", "type": "actor", "description": "Registered user who can borrow and reserve books"},
    {"name": "Book", "type": "object", "description": "Physical item available for borrowing", "properties": {"isbn": "string", "genre": "string"}},
    {"name": "Reservation", "type": "object", "description": "A hold placed on a book by a member"}
  ],
  "relations": [
    {"source": "Library", "target": "Book", "type": "contains", "label": "holds inventory of"},
    {"source": "Member", "target": "Book", "type": "uses", "label": "borrows"},
    {"source": "Member", "target": "Reservation", "type": "produces", "label": "creates reservation for a book"}
  ],
  "processes": [
    {"name": "Book Borrowing", "description": "Member borrows a book from the library", "steps": [{"order": 1, "action": "Member selects book", "actor": "Member"}, {"order": 2, "action": "Library checks availability", "actor": "Library"}, {"order": 3, "action": "Book is checked out to member", "actor": "Library"}], "participants": ["Member", "Library", "Book"], "outcomes": ["Book is borrowed"]}
  ],
  "constraints": [
    {"name": "Late Return Fine", "type": "rule", "description": "Late returns incur a $1/day fine", "scope": ["Member", "Book"], "severity": "hard"}
  ]
}

Note how the example extracts the implicit Reservation entity and the Library system entity even though they're not directly named as such. Apply the same thoroughness to the actual input.

${BASE_SCHEMA}`,

  code: `You are a world-model extraction agent specialized in SOURCE CODE analysis. Analyze the code and extract its architectural world model.

Focus on:
- Modules, classes, functions, and services as entities
- Import/export dependencies as relations — TRACE IMPORT CHAINS: if module A imports from module B and calls B's functions, that's a "uses" relation
- Data flow between components (who produces what, who consumes what)
- API endpoints, routes, handlers as processes with steps
- Type definitions and interfaces as concept entities
- Database models and schemas as resource entities
- Configuration and environment variables as constraints
- Error handling patterns as boundary constraints
- Authentication/authorization as authorization constraints
- External service integrations as system entities
- CLI commands / entry points as actor entities — trace which systems each command invokes by following the imports in its action handler
- Utility modules that are imported by multiple files — these are shared systems, create "uses" relations from each consumer

CRITICAL RULES:
- Follow import chains to establish relations. If file A imports function X from file B, and function X operates on type T from file C, then A uses B and B depends_on C
- Do NOT create entities for local variables, function parameters, intermediate values, or internal state. Only extract architectural components (modules, services, agents, data types, external systems)
- Do NOT create orphan entities — every entity should have at least one relation
- Name entities after the COMPONENT they represent, not the variable name (e.g., "Extraction Agent" not "extractionAgent", "Pipeline" not "pipeline instance")
- Prefer fewer, well-connected entities over many disconnected ones

Infer the ARCHITECTURE, not just list files. Model how data flows through the system.

EXAMPLE A — TypeScript codebase:
\`\`\`typescript
// src/auth/jwt.ts
import { sign, verify } from "jsonwebtoken";
export function createToken(userId: string): string { ... }
export function verifyToken(token: string): Payload { ... }

// src/middleware/auth.ts
import { verifyToken } from "../auth/jwt.js";
export function authMiddleware(req, res, next) { ... }

// src/routes/users.ts
import { authMiddleware } from "../middleware/auth.js";
import { UserRepository } from "../db/user-repo.js";
export const router = Router();
router.get("/me", authMiddleware, async (req, res) => {
  const user = await UserRepository.findById(req.userId);
  res.json(user);
});
\`\`\`

Expected extraction (abbreviated):
{
  "entities": [
    {"name": "JWT Module", "type": "system", "description": "Handles JWT token creation and verification", "tags": ["auth"]},
    {"name": "Auth Middleware", "type": "system", "description": "Express middleware that validates JWT tokens on incoming requests"},
    {"name": "Users Router", "type": "system", "description": "Express router exposing user-related HTTP endpoints"},
    {"name": "User Repository", "type": "resource", "description": "Database access layer for user records"},
    {"name": "Payload", "type": "concept", "description": "Decoded JWT payload type containing userId and claims"}
  ],
  "relations": [
    {"source": "Auth Middleware", "target": "JWT Module", "type": "uses", "label": "calls verifyToken"},
    {"source": "Users Router", "target": "Auth Middleware", "type": "depends_on", "label": "applies auth guard"},
    {"source": "Users Router", "target": "User Repository", "type": "uses", "label": "queries user by id"}
  ],
  "processes": [
    {"name": "Authenticated User Lookup", "description": "Validate token then fetch user from database", "trigger": "GET /me request", "steps": [{"order": 1, "action": "Auth Middleware verifies JWT token", "actor": "Auth Middleware", "inputs": ["JWT Module"], "outputs": ["Payload"]}, {"order": 2, "action": "Users Router fetches user record", "actor": "Users Router", "inputs": ["User Repository"], "outputs": ["User"]}], "participants": ["Auth Middleware", "Users Router", "JWT Module", "User Repository"], "outcomes": ["User JSON returned to client"]}
  ],
  "constraints": [
    {"name": "JWT Required", "type": "authorization", "description": "All /me endpoints require a valid JWT token", "scope": ["Users Router", "Auth Middleware"], "severity": "hard"}
  ]
}

EXAMPLE B — Python codebase:
\`\`\`python
# pipeline/fetch.py
import httpx
def fetch_url(url: str) -> str: ...

# pipeline/extract.py
from pipeline.fetch import fetch_url
from llm.client import complete
def extract_entities(url: str) -> list[Entity]: ...

# pipeline/store.py
from pipeline.extract import extract_entities
import psycopg2
def store_results(url: str, conn) -> None: ...

# cli.py
from pipeline.store import store_results
import argparse
def main(): ...
\`\`\`

Expected extraction (abbreviated):
{
  "entities": [
    {"name": "Fetch Module", "type": "system", "description": "HTTP fetching utility using httpx"},
    {"name": "Extract Module", "type": "system", "description": "Entity extraction module that calls LLM and fetch"},
    {"name": "Store Module", "type": "system", "description": "Persists extracted entities to PostgreSQL"},
    {"name": "CLI Entry Point", "type": "actor", "description": "Command-line interface that drives the pipeline"},
    {"name": "LLM Client", "type": "system", "description": "External LLM completion service"},
    {"name": "PostgreSQL", "type": "resource", "description": "Relational database storing extraction results"}
  ],
  "relations": [
    {"source": "Extract Module", "target": "Fetch Module", "type": "uses", "label": "imports fetch_url"},
    {"source": "Extract Module", "target": "LLM Client", "type": "uses", "label": "imports complete"},
    {"source": "Store Module", "target": "Extract Module", "type": "uses", "label": "imports extract_entities"},
    {"source": "Store Module", "target": "PostgreSQL", "type": "uses", "label": "writes via psycopg2"},
    {"source": "CLI Entry Point", "target": "Store Module", "type": "controls", "label": "invokes store_results"}
  ],
  "processes": [
    {"name": "URL Ingestion Pipeline", "description": "Fetch a URL, extract entities, and persist them", "trigger": "CLI invocation", "steps": [{"order": 1, "action": "CLI calls store_results with URL", "actor": "CLI Entry Point"}, {"order": 2, "action": "Extract module fetches URL content", "actor": "Extract Module", "inputs": ["Fetch Module"], "outputs": ["raw content"]}, {"order": 3, "action": "Extract module calls LLM to identify entities", "actor": "Extract Module", "inputs": ["LLM Client"], "outputs": ["Entity list"]}, {"order": 4, "action": "Store module writes entities to database", "actor": "Store Module", "inputs": ["Entity list"], "outputs": ["PostgreSQL"]}], "participants": ["CLI Entry Point", "Fetch Module", "Extract Module", "Store Module", "LLM Client", "PostgreSQL"], "outcomes": ["Entities persisted to database"]}
  ],
  "constraints": [
    {"name": "DB Connection Required", "type": "dependency", "description": "Store module requires an active psycopg2 connection", "scope": ["Store Module", "PostgreSQL"], "severity": "hard"}
  ]
}

Note: module boundaries become system/actor entities; imports become uses/depends_on relations; exported functions become process steps; external packages (httpx, psycopg2, jsonwebtoken) become resource or system entities.

${BASE_SCHEMA}`,

  conversation: `You are a world-model extraction agent specialized in CONVERSATION analysis. Analyze the conversation and extract a structured world model of its content.

Focus on:
- Participants as actor entities
- Topics discussed as concept entities
- Systems/products/tools mentioned as system/object entities
- Decisions made as event entities with relations to what they affect
- Action items as process entities with steps and assigned actors
- Agreements and disagreements as relations (enables/opposes)
- Deadlines and commitments as temporal constraints
- Open questions as extraction_notes

Model the SUBSTANCE of the conversation, not the conversation itself.

${BASE_SCHEMA}`,

  document: `You are a world-model extraction agent specialized in DOCUMENT and STRUCTURED DATA analysis. Analyze the input and extract a complete structured world model.

If the input is JSON:
- Object keys become entities or properties
- Nested objects become "contains" or "part_of" relations
- Arrays of objects become entity collections with shared type
- API endpoints become processes with request/response steps
- Schema definitions (OpenAPI, JSON Schema) become concept entities with property details

If the input is YAML/TOML:
- Configuration sections become system entities
- Key-value pairs become properties on entities
- References between sections become relations

If the input is CSV/tabular:
- Column headers define entity properties
- Each row is an instance — extract the SCHEMA, not individual rows
- Foreign key patterns become relations

For all documents:
- All named entities (organizations, roles, systems, concepts, regulations)
- Hierarchical relationships (org charts, system architectures, taxonomies)
- Described workflows and procedures as processes
- Requirements, policies, and rules as constraints
- Defined terms as concept entities
- Dependencies between components or teams
- Temporal sequences (phases, milestones, deadlines)

Treat the document as a specification of a world — extract that world completely.

${BASE_SCHEMA}`,

  url: `You are a world-model extraction agent. The input is content fetched from a URL. Analyze it and extract a complete structured world model.

Focus on:
- The domain/topic the page covers
- All entities, services, products, or concepts described
- Relationships between them
- Any processes, workflows, or user journeys described
- Pricing, limitations, or constraints mentioned
- Technical specifications as properties on entities

${BASE_SCHEMA}`,

  mixed: `You are a world-model extraction agent. The input contains MIXED content types (possibly text, code, data, and structured content together).

Focus on:
- Identify what each section represents (narrative, code, data, config)
- Extract entities from ALL sections — they may reference each other
- Cross-reference: code entities may implement concepts described in text
- Data sections may define entity properties or constraints
- Use consistent entity names across all sections

${BASE_SCHEMA}`,
};

export function getPromptForSourceType(sourceType: string): string {
  return PROMPTS[sourceType] ?? PROMPTS.text;
}
