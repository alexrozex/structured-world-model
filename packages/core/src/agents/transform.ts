import { callAgentJSON } from "../utils/llm.js";
import type { WorldModelType } from "../schema/index.js";
import type { RawExtraction } from "./extraction.js";
import { validateExtraction } from "../schema/extraction.js";
import { structuringAgent } from "./structuring.js";
import { mergeWorldModels } from "../utils/merge.js";
import { validationAgent } from "./validation.js";

const TRANSFORM_PROMPT = `You are a world-model transformation agent. You are given an existing world model and a transformation instruction.

Your job is to output the CHANGES needed to apply the transformation. Output entities, relations, processes, and constraints that should be ADDED to the model.

For REMOVALS, add an extraction_note like "REMOVE: Entity Name" or "REMOVE RELATION: Source -> Target".
For MODIFICATIONS, output the entity/relation with the new values — the merge will update by name.

## Existing World Model:
{modelSummary}

## Rules:
- Only output what CHANGES — don't re-output unchanged elements
- Reference existing entity names exactly
- If the transformation adds new entities, include full descriptions
- If the transformation modifies entities, output them with updated fields
- Note removals in extraction_notes with "REMOVE:" prefix

Output ONLY valid JSON with this structure:
{
  "entities": [{ "name": "string", "type": "actor|object|system|concept|location|event|group|resource", "description": "string", "tags": ["string"] }],
  "relations": [{ "source": "entity name", "target": "entity name", "type": "has|is_a|part_of|depends_on|produces|consumes|controls|communicates_with|located_in|triggers|inherits|contains|uses|flows_to|opposes|enables|transforms", "label": "string" }],
  "processes": [{ "name": "string", "description": "string", "steps": [{ "order": 1, "action": "string", "actor": "entity name" }], "participants": ["entity name"], "outcomes": ["string"] }],
  "constraints": [{ "name": "string", "type": "invariant|rule|boundary|dependency|capacity|temporal|authorization", "description": "string", "scope": ["entity name"], "severity": "hard|soft" }],
  "model_name": "",
  "model_description": "",
  "source_summary": "transformation applied",
  "confidence": 0.8,
  "extraction_notes": ["string"]
}`;

function summarizeModel(model: WorldModelType): string {
  const entities = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");
  const relations = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} —[${r.type}]→ ${tgt}`;
    })
    .join("\n");
  const processes = model.processes
    .map((p) => `- ${p.name}: ${p.description}`)
    .join("\n");
  const constraints = model.constraints
    .map((c) => `- [${c.severity}] ${c.name}: ${c.description}`)
    .join("\n");

  return `Entities:\n${entities}\n\nRelations:\n${relations}\n\nProcesses:\n${processes}\n\nConstraints:\n${constraints}`;
}

export async function transformWorldModel(
  model: WorldModelType,
  instruction: string,
): Promise<{ model: WorldModelType; changes: string[] }> {
  const summary = summarizeModel(model);
  const systemPrompt = TRANSFORM_PROMPT.replace("{modelSummary}", summary);
  const userMessage = `Apply this transformation to the world model:\n\n${instruction}`;

  const rawResult = await callAgentJSON<unknown>(systemPrompt, userMessage, {
    maxTokens: 16384,
  });

  const { extraction, issues } = validateExtraction(rawResult);
  if (issues.length > 0) {
    process.stderr.write(`  [transform validation] ${issues.join("; ")}\n`);
  }

  const changes: string[] = [];

  // Process removals from extraction_notes
  let result = model;
  const removalNotes = (extraction.extraction_notes ?? []).filter((n) =>
    n.startsWith("REMOVE"),
  );

  if (removalNotes.length > 0) {
    const entitiesToRemove = new Set<string>();
    for (const note of removalNotes) {
      const entityMatch = note.match(/REMOVE:\s*(.+)/i);
      if (entityMatch) {
        entitiesToRemove.add(entityMatch[1].trim().toLowerCase());
        changes.push(`Removed: ${entityMatch[1].trim()}`);
      }
    }

    if (entitiesToRemove.size > 0) {
      const filteredEntities = result.entities.filter(
        (e) => !entitiesToRemove.has(e.name.toLowerCase()),
      );
      const removedIds = new Set(
        result.entities
          .filter((e) => entitiesToRemove.has(e.name.toLowerCase()))
          .map((e) => e.id),
      );
      result = {
        ...result,
        entities: filteredEntities,
        relations: result.relations.filter(
          (r) => !removedIds.has(r.source) && !removedIds.has(r.target),
        ),
        processes: result.processes.map((p) => ({
          ...p,
          participants: p.participants.filter((pid) => !removedIds.has(pid)),
        })),
        constraints: result.constraints.map((c) => ({
          ...c,
          scope: c.scope.filter((sid) => !removedIds.has(sid)),
        })),
      };
    }
  }

  // Merge additions
  const addedExtraction = extraction as unknown as RawExtraction;
  if (
    addedExtraction.entities.length > 0 ||
    addedExtraction.relations.length > 0 ||
    addedExtraction.processes.length > 0 ||
    addedExtraction.constraints.length > 0
  ) {
    const { worldModel: deltaModel } = await structuringAgent({
      input: { raw: instruction, sourceType: "text" },
      extraction: addedExtraction,
    });

    if (deltaModel.entities.length > 0)
      changes.push(`Added ${deltaModel.entities.length} entities`);
    if (deltaModel.relations.length > 0)
      changes.push(`Added ${deltaModel.relations.length} relations`);
    if (deltaModel.processes.length > 0)
      changes.push(`Added ${deltaModel.processes.length} processes`);
    if (deltaModel.constraints.length > 0)
      changes.push(`Added ${deltaModel.constraints.length} constraints`);

    result = mergeWorldModels(result, deltaModel, {
      name: result.name,
      description: result.description,
    });
  }

  // Re-validate
  const { worldModel: validated } = await validationAgent({
    input: { raw: instruction, sourceType: "text" },
    worldModel: result,
  });

  return { model: validated, changes };
}
