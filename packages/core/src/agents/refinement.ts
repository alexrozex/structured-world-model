import { callAgentJSON, callAgentStructured } from "../utils/llm.js";
import type { WorldModelType } from "../schema/index.js";
import type { PipelineInput } from "../pipeline/index.js";
import type { RawExtraction } from "./extraction.js";
import {
  validateExtraction,
  getRawExtractionJsonSchema,
} from "../schema/extraction.js";
import { structuringAgent } from "./structuring.js";
import { validationAgent } from "./validation.js";
import { mergeWorldModels } from "../utils/merge.js";

const REFINEMENT_PROMPT = `You are a world-model refinement agent. You are given an EXISTING world model and NEW input.
Your job is to extract ONLY what the new input adds, changes, or contradicts relative to the existing model.

## Existing World Model Summary:
{existingModelSummary}

## Instructions:
1. Extract new entities NOT already in the existing model
2. Extract new relations between entities (new or existing)
3. Extract new processes or refinements to existing processes
4. Extract new constraints or modifications to existing ones
5. If the new input CONTRADICTS something in the existing model, extract the new version and note the contradiction in extraction_notes

RULES:
- DO NOT re-extract entities/relations that already exist unchanged
- DO reference existing entity names exactly when creating new relations to them
- Mark confidence based on how clearly the new input supports each extraction
- Note in extraction_notes what was added vs what was modified
- Output ONLY valid JSON matching the extraction schema`;

function summarizeModel(model: WorldModelType): string {
  const entityList = model.entities
    .map((e) => `  - ${e.name} (${e.type}): ${e.description.slice(0, 100)}`)
    .join("\n");

  const relationList = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `  - ${src} —[${r.type}]→ ${tgt}`;
    })
    .join("\n");

  const processList = model.processes
    .map((p) => `  - ${p.name}: ${p.description.slice(0, 80)}`)
    .join("\n");

  const constraintList = model.constraints
    .map((c) => `  - [${c.severity}] ${c.name}: ${c.description.slice(0, 80)}`)
    .join("\n");

  return `Entities (${model.entities.length}):\n${entityList}\n\nRelations (${model.relations.length}):\n${relationList}\n\nProcesses (${model.processes.length}):\n${processList}\n\nConstraints (${model.constraints.length}):\n${constraintList}`;
}

export async function refineWorldModel(
  existingModel: WorldModelType,
  newInput: PipelineInput,
  options?: {
    onStageStart?: (name: string) => void;
    onStageEnd?: (name: string, ms: number) => void;
  },
): Promise<{ worldModel: WorldModelType; delta: WorldModelType }> {
  const summary = summarizeModel(existingModel);
  const systemPrompt = REFINEMENT_PROMPT.replace(
    "{existingModelSummary}",
    summary,
  );

  // Extract delta
  options?.onStageStart?.("refinement-extraction");
  const start = Date.now();

  const userMessage = `Given the existing world model above, analyze this NEW ${newInput.sourceType} input and extract only what's new or changed.\n\n---\n\n${newInput.raw}`;

  let deltaExtraction: RawExtraction;
  try {
    const jsonSchema = getRawExtractionJsonSchema();
    const raw = await callAgentStructured<unknown>(
      systemPrompt,
      userMessage,
      jsonSchema,
      { maxTokens: 16384 },
    );
    const { extraction } = validateExtraction(raw);
    deltaExtraction = extraction as unknown as RawExtraction;
  } catch {
    // Fallback to unstructured JSON
    deltaExtraction = await callAgentJSON<RawExtraction>(
      systemPrompt,
      userMessage,
      { maxTokens: 16384 },
    );
  }

  options?.onStageEnd?.("refinement-extraction", Date.now() - start);

  // Structure the delta into a world model
  options?.onStageStart?.("refinement-structuring");
  const structStart = Date.now();

  const { worldModel: deltaModel } = await structuringAgent({
    input: newInput,
    extraction: deltaExtraction,
  });

  options?.onStageEnd?.("refinement-structuring", Date.now() - structStart);

  // Merge existing + delta
  options?.onStageStart?.("refinement-merge");
  const mergeStart = Date.now();

  const merged = mergeWorldModels(existingModel, deltaModel, {
    name: existingModel.name,
    description: existingModel.description,
  });

  options?.onStageEnd?.("refinement-merge", Date.now() - mergeStart);

  // Validate the merged result
  options?.onStageStart?.("refinement-validation");
  const valStart = Date.now();

  const { worldModel: validatedModel } = await validationAgent({
    input: newInput,
    worldModel: merged,
  });

  options?.onStageEnd?.("refinement-validation", Date.now() - valStart);

  return { worldModel: validatedModel, delta: deltaModel };
}
