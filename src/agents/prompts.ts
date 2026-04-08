const BASE_SCHEMA = `You must output ONLY valid JSON with this structure:
{
  "entities": [{ "name", "type" (actor|object|system|concept|location|event|group|resource), "description", "properties"?, "tags"? }],
  "relations": [{ "source" (entity name), "target" (entity name), "type" (has|is_a|part_of|depends_on|produces|consumes|controls|communicates_with|located_in|triggers|inherits|contains|uses|flows_to|opposes|enables|transforms), "label", "bidirectional"? }],
  "processes": [{ "name", "description", "trigger"?, "steps": [{ "order", "action", "actor"?, "inputs"?, "outputs"? }], "participants" (entity names), "outcomes" }],
  "constraints": [{ "name", "type" (invariant|rule|boundary|dependency|capacity|temporal|authorization), "description", "scope" (entity names), "severity" (hard|soft) }],
  "model_name", "model_description", "source_summary", "confidence" (0-1), "extraction_notes": []
}

RULES:
- Entity names in relations/processes MUST exactly match entity names
- Extract EVERYTHING — be thorough, not selective
- Infer implicit entities and relations
- Output ONLY valid JSON — no commentary outside the JSON`;

export const PROMPTS: Record<string, string> = {
  text: `You are a world-model extraction agent. Analyze the given text and extract a complete structured world model.

Focus on:
- Named entities (people, organizations, places, things, concepts)
- Relationships between them (ownership, hierarchy, dependency, flow)
- Any described processes, workflows, or sequences of events
- Rules, constraints, limitations mentioned or implied
- Implicit entities that must exist for described behaviors to work

${BASE_SCHEMA}`,

  code: `You are a world-model extraction agent specialized in SOURCE CODE analysis. Analyze the code and extract its architectural world model.

Focus on:
- Modules, classes, functions, and services as entities
- Import/export dependencies as relations
- Data flow between components (who produces what, who consumes what)
- API endpoints, routes, handlers as processes with steps
- Type definitions and interfaces as concept entities
- Database models and schemas as resource entities
- Configuration and environment variables as constraints
- Error handling patterns as boundary constraints
- Authentication/authorization as authorization constraints
- External service integrations as system entities

Infer the ARCHITECTURE, not just list files. Model how data flows through the system.

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

  document: `You are a world-model extraction agent specialized in DOCUMENT analysis. Analyze the document and extract a complete structured world model.

Focus on:
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
