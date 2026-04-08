import { callAgentJSON } from "../utils/llm.js";
import type { WorldModelType } from "../schema/index.js";
import type { PipelineInput } from "../pipeline/index.js";
import type { RawExtraction } from "./extraction.js";
import { validateExtraction } from "../schema/extraction.js";

const SECOND_PASS_PROMPT = `You are a world-model COMPLETENESS agent. You are given:
1. The original raw input
2. A world model that was already extracted from it

Your job is to find everything the FIRST PASS MISSED. The first pass captures what's explicitly stated. You capture what's IMPLICIT.

Look for:

**Missing entities:**
- Entities that must EXIST for the described processes to work, but were never named
- Infrastructure entities (authentication, logging, error handling, networking)
- Role entities implied by actions ("someone approves" → there's an Approver actor)
- Data entities implied by processes ("saves to database" → there's a Record object)

**Missing relations:**
- Dependencies that are logically necessary but not stated
- Hierarchical relations implied by context (if X contains Y, Y is part_of X)
- Communication paths implied by processes (if A triggers B, A communicates_with B)

**Missing processes:**
- Error/failure paths (what happens when the main process fails?)
- Setup/teardown processes (what must happen before/after the described flow?)
- Maintenance processes (backups, migrations, updates)

**Missing constraints:**
- Physical/logical impossibilities not stated (can't be in two places, can't exceed capacity)
- Temporal constraints implied by ordering (step 2 can't happen before step 1)
- Authorization constraints implied by roles (only admins can X)
- Data integrity constraints (required fields, unique identifiers, referential integrity)

RULES:
- ONLY extract what's NEW — do not re-extract entities/relations already in the model
- Reference existing entity names exactly when creating relations to them
- Every extraction must be JUSTIFIED by the input — no hallucination
- Set confidence lower (0.3-0.7) since these are inferences, not direct extractions
- In extraction_notes, explain WHY each new element was inferred
- Output ONLY valid JSON matching the extraction schema`;

function summarizeModelForPrompt(model: WorldModelType): string {
  const entities = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");

  const relations = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} —[${r.type}]→ ${tgt}: ${r.label}`;
    })
    .join("\n");

  const processes = model.processes
    .map((p) => {
      const steps = p.steps
        .map((s) => {
          const actor = s.actor
            ? (model.entities.find((e) => e.id === s.actor)?.name ?? s.actor)
            : "unknown";
          return `  ${s.order}. ${actor}: ${s.action}`;
        })
        .join("\n");
      return `- ${p.name}: ${p.description}\n${steps}`;
    })
    .join("\n");

  const constraints = model.constraints
    .map((c) => `- [${c.severity}] ${c.name}: ${c.description}`)
    .join("\n");

  return `ENTITIES (${model.entities.length}):\n${entities}\n\nRELATIONS (${model.relations.length}):\n${relations}\n\nPROCESSES (${model.processes.length}):\n${processes}\n\nCONSTRAINTS (${model.constraints.length}):\n${constraints}`;
}

export async function secondPassAgent(
  originalInput: PipelineInput,
  currentModel: WorldModelType,
): Promise<RawExtraction> {
  const modelSummary = summarizeModelForPrompt(currentModel);

  const userMessage = `## Original Input:\n${originalInput.raw}\n\n---\n\n## Already Extracted World Model:\n${modelSummary}\n\n---\n\nWhat did the first pass MISS? Extract only NEW entities, relations, processes, and constraints that are implicit in the input but not yet in the model.`;

  const rawResult = await callAgentJSON<unknown>(
    SECOND_PASS_PROMPT,
    userMessage,
    {
      maxTokens: 16384,
    },
  );

  const { extraction, issues } = validateExtraction(rawResult);
  if (issues.length > 0) {
    process.stderr.write(`  [second-pass validation] ${issues.join("; ")}\n`);
  }

  return extraction as unknown as RawExtraction;
}
