import { callAgentJSON, checkInputSize } from "../utils/llm.js";
import type { PipelineInput } from "../pipeline/index.js";
import { chunkInput } from "./chunker.js";
import { getPromptForSourceType } from "./prompts.js";
import { validateExtraction } from "../schema/extraction.js";

export interface RawExtraction {
  entities: Array<{
    name: string;
    type: string;
    description: string;
    properties?: Record<string, unknown>;
    tags?: string[];
    confidence?: number;
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

const CHUNK_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

IMPORTANT: You are processing chunk {chunkIndex} of {chunkTotal} from a larger input.
- Extract everything from THIS chunk
- Use consistent entity names (the chunks will be merged later)
- Note in extraction_notes that this is a partial extraction from chunk {chunkIndex}/{chunkTotal}`;

function mergeRawExtractions(extractions: RawExtraction[]): RawExtraction {
  const merged: RawExtraction = {
    entities: [],
    relations: [],
    processes: [],
    constraints: [],
    model_name: extractions[0]?.model_name ?? "Untitled",
    model_description: extractions[0]?.model_description ?? "",
    source_summary: extractions
      .map((e) => e.source_summary)
      .filter(Boolean)
      .join("; "),
    confidence: 0,
    extraction_notes: [],
  };

  // Deduplicate entities by normalized name
  const entityMap = new Map<string, RawExtraction["entities"][number]>();
  for (const ext of extractions) {
    for (const e of ext.entities) {
      const key = e.name.toLowerCase().trim();
      if (!entityMap.has(key)) {
        entityMap.set(key, e);
      } else {
        const existing = entityMap.get(key)!;
        // Keep longer description, merge props/tags
        if (e.description.length > existing.description.length) {
          existing.description = e.description;
        }
        if (e.properties) {
          existing.properties = { ...existing.properties, ...e.properties };
        }
        if (e.tags) {
          existing.tags = [...new Set([...(existing.tags ?? []), ...e.tags])];
        }
      }
    }
  }
  merged.entities = [...entityMap.values()];

  // Deduplicate relations by (source, target, type)
  const relSet = new Set<string>();
  for (const ext of extractions) {
    for (const r of ext.relations) {
      const key = `${r.source.toLowerCase()}::${r.type}::${r.target.toLowerCase()}`;
      if (!relSet.has(key)) {
        relSet.add(key);
        merged.relations.push(r);
      }
    }
  }

  // Deduplicate processes by name
  const procSet = new Set<string>();
  for (const ext of extractions) {
    for (const p of ext.processes) {
      const key = p.name.toLowerCase().trim();
      if (!procSet.has(key)) {
        procSet.add(key);
        merged.processes.push(p);
      }
    }
  }

  // Deduplicate constraints by name
  const cstrSet = new Set<string>();
  for (const ext of extractions) {
    for (const c of ext.constraints) {
      const key = c.name.toLowerCase().trim();
      if (!cstrSet.has(key)) {
        cstrSet.add(key);
        merged.constraints.push(c);
      }
    }
  }

  // Average confidence
  const confidences = extractions.map((e) => e.confidence).filter((c) => c > 0);
  merged.confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0.5;

  // Collect all notes
  merged.extraction_notes = extractions.flatMap(
    (e) => e.extraction_notes ?? [],
  );
  if (extractions.length > 1) {
    merged.extraction_notes.push(
      `Merged from ${extractions.length} chunks (${merged.entities.length} unique entities after dedup)`,
    );
  }

  return merged;
}

class EmptyExtractionError extends Error {
  constructor(issues: string[]) {
    super(`Extraction produced empty result: ${issues.join("; ")}`);
    this.name = "EmptyExtractionError";
  }
}

function validateAndCoerce(raw: unknown, throwOnEmpty = false): RawExtraction {
  const { extraction, issues } = validateExtraction(raw);
  if (issues.length > 0) {
    process.stderr.write(`  [validation] ${issues.join("; ")}\n`);
  }
  // If extraction is completely empty and we should retry, throw
  if (
    throwOnEmpty &&
    extraction.entities.length === 0 &&
    extraction.relations.length === 0
  ) {
    throw new EmptyExtractionError(issues);
  }
  // Cast validated extraction to RawExtraction (shapes are compatible)
  return extraction as unknown as RawExtraction;
}

export async function extractionAgent(
  input: PipelineInput,
): Promise<{ input: PipelineInput; extraction: RawExtraction }> {
  if (!input.raw || !input.raw.trim()) {
    throw new Error("Cannot extract from empty input");
  }

  const sizeCheck = checkInputSize(input.raw);
  if (sizeCheck.warning) {
    process.stderr.write(`  [warn] ${sizeCheck.warning}\n`);
  }

  const chunks = chunkInput(input.raw);
  const sourcePrompt = getPromptForSourceType(input.sourceType);

  if (chunks.length === 1) {
    // Single chunk — direct extraction with source-specific prompt, retry on empty
    const userMessage = `Analyze the following ${input.sourceType} input and extract a complete world model.\n\n---\n\n${input.raw}`;
    const MAX_EMPTY_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
      const rawResult = await callAgentJSON<unknown>(
        sourcePrompt,
        userMessage,
        {
          maxTokens: 16384,
        },
      );
      try {
        return {
          input,
          extraction: validateAndCoerce(rawResult, attempt < MAX_EMPTY_RETRIES),
        };
      } catch (err) {
        if (
          err instanceof EmptyExtractionError &&
          attempt < MAX_EMPTY_RETRIES
        ) {
          process.stderr.write(
            `  [retry] empty extraction, attempt ${attempt + 1}/${MAX_EMPTY_RETRIES}...\n`,
          );
          continue;
        }
        // Final attempt — accept whatever we got (coerced empty)
        return { input, extraction: validateAndCoerce(rawResult, false) };
      }
    }
    // Shouldn't reach here, but satisfy TypeScript
    const rawResult = await callAgentJSON<unknown>(sourcePrompt, userMessage, {
      maxTokens: 16384,
    });
    return { input, extraction: validateAndCoerce(rawResult, false) };
  }

  // Multi-chunk — extract per chunk with source-specific prompt, then merge
  const chunkSuffix = `\n\nIMPORTANT: You are processing chunk {chunkIndex} of {chunkTotal} from a larger input.\n- Extract everything from THIS chunk\n- Use consistent entity names (chunks will be merged later)\n- Note in extraction_notes that this is a partial extraction from chunk {chunkIndex}/{chunkTotal}`;

  const extractions: RawExtraction[] = [];
  for (const chunk of chunks) {
    const prompt = (sourcePrompt + chunkSuffix)
      .replace(/\{chunkIndex\}/g, String(chunk.index + 1))
      .replace(/\{chunkTotal\}/g, String(chunk.total));

    const userMessage = `Analyze chunk ${chunk.index + 1}/${chunk.total} of a ${input.sourceType} input and extract all world model elements.\n\n---\n\n${chunk.text}`;

    const rawResult = await callAgentJSON<unknown>(prompt, userMessage, {
      maxTokens: 16384,
    });
    extractions.push(validateAndCoerce(rawResult));
  }

  return { input, extraction: mergeRawExtractions(extractions) };
}
