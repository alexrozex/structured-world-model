import { callAgentJSON } from "../utils/llm.js";
import type { PipelineInput } from "../pipeline/index.js";

export interface RawExtraction {
  entities: Array<{
    name: string;
    type: string;
    description: string;
    properties?: Record<string, unknown>;
    tags?: string[];
  }>;
  relations: Array<{
    source: string;
    target: string;
    type: string;
    label: string;
    bidirectional?: boolean;
  }>;
  processes: Array<{
    name: string;
    description: string;
    trigger?: string;
    steps: Array<{
      order: number;
      action: string;
      actor?: string;
      inputs?: string[];
      outputs?: string[];
    }>;
    participants: string[];
    outcomes: string[];
  }>;
  constraints: Array<{
    name: string;
    type: string;
    description: string;
    scope: string[];
    severity: "hard" | "soft";
  }>;
  model_name: string;
  model_description: string;
  source_summary: string;
  confidence: number;
  extraction_notes: string[];
}

const SYSTEM_PROMPT = `You are a world-model extraction agent. Your job is to analyze ANY input — text, code, conversation, documentation, descriptions — and extract a complete structured world model from it.

You must extract:

1. **Entities** — every distinct thing, actor, system, concept, resource, location, event, or group mentioned or implied. For each:
   - name: clear identifier
   - type: one of [actor, object, system, concept, location, event, group, resource]
   - description: what it is and why it matters in context
   - properties: any measurable/specific attributes
   - tags: categorization labels

2. **Relations** — every connection between entities. For each:
   - source: name of source entity (must match an entity name exactly)
   - target: name of target entity (must match an entity name exactly)
   - type: one of [has, is_a, part_of, depends_on, produces, consumes, controls, communicates_with, located_in, triggers, inherits, contains, uses, flows_to, opposes, enables, transforms]
   - label: human-readable description
   - bidirectional: true if the relation goes both ways

3. **Processes** — every dynamic sequence, workflow, or series of events. For each:
   - name, description, trigger
   - steps: ordered list with action, actor (entity name), inputs (entity names), outputs (entity names)
   - participants: all entity names involved
   - outcomes: what the process produces or changes

4. **Constraints** — every rule, invariant, limitation, boundary, or requirement. For each:
   - name, description
   - type: one of [invariant, rule, boundary, dependency, capacity, temporal, authorization]
   - scope: entity names this applies to
   - severity: hard (violation = error) or soft (violation = warning)

5. **Metadata**:
   - model_name: a concise name for the world being modeled
   - model_description: what domain/system this represents
   - source_summary: brief description of the input
   - confidence: 0-1 overall extraction confidence
   - extraction_notes: ambiguities, gaps, assumptions you made

RULES:
- Extract EVERYTHING — be thorough, not selective
- Infer implicit entities and relations (e.g., if "users log in", there's a User actor, an Authentication system, and a Login process)
- Entity names in relations/processes MUST exactly match entity names
- Output ONLY valid JSON matching the schema — no commentary outside the JSON
- If the input is code, model the architecture (modules, data flows, APIs, etc.)
- If the input is a conversation, model the topics, participants, decisions, and action items
- If the input is vague, extract what you can and note gaps in extraction_notes`;

export async function extractionAgent(
  input: PipelineInput,
): Promise<{ input: PipelineInput; extraction: RawExtraction }> {
  const userMessage = `Analyze the following ${input.sourceType} input and extract a complete world model.\n\n---\n\n${input.raw}`;

  const extraction = await callAgentJSON<RawExtraction>(
    SYSTEM_PROMPT,
    userMessage,
    {
      maxTokens: 16384,
    },
  );

  return { input, extraction };
}
