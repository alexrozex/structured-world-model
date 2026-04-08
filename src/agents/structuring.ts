import type { WorldModelType } from "../schema/index.js";
import type { PipelineInput } from "../pipeline/index.js";
import type { RawExtraction } from "./extraction.js";
import { genId } from "../utils/ids.js";

export interface StructuringOutput {
  input: PipelineInput;
  worldModel: WorldModelType;
}

export function structuringAgent(stageInput: {
  input: PipelineInput;
  extraction: RawExtraction;
}): Promise<StructuringOutput> {
  const { input, extraction } = stageInput;

  // Build entity name → ID map
  const entityIdMap = new Map<string, string>();
  const entities = extraction.entities.map((e) => {
    const id = genId("ent");
    entityIdMap.set(e.name, id);
    return {
      id,
      name: e.name,
      type: e.type as WorldModelType["entities"][number]["type"],
      description: e.description,
      properties: e.properties,
      tags: e.tags,
    };
  });

  const resolveEntityId = (name: string): string => {
    const existing = entityIdMap.get(name);
    if (existing) return existing;
    // Create a placeholder entity for unresolved references
    const id = genId("ent");
    entityIdMap.set(name, id);
    entities.push({
      id,
      name,
      type: "object",
      description: `Auto-created entity for unresolved reference: ${name}`,
      properties: undefined,
      tags: ["auto-created"],
    });
    return id;
  };

  const relations = extraction.relations.map((r) => ({
    id: genId("rel"),
    type: r.type as WorldModelType["relations"][number]["type"],
    source: resolveEntityId(r.source),
    target: resolveEntityId(r.target),
    label: r.label,
    bidirectional: r.bidirectional,
  }));

  const processes = extraction.processes.map((p) => ({
    id: genId("proc"),
    name: p.name,
    description: p.description,
    trigger: p.trigger,
    steps: p.steps.map((s) => ({
      order: s.order,
      action: s.action,
      actor: s.actor ? resolveEntityId(s.actor) : undefined,
      input: s.inputs?.map(resolveEntityId),
      output: s.outputs?.map(resolveEntityId),
    })),
    participants: p.participants.map(resolveEntityId),
    outcomes: p.outcomes,
  }));

  const constraints = extraction.constraints.map((c) => ({
    id: genId("cstr"),
    name: c.name,
    type: c.type as WorldModelType["constraints"][number]["type"],
    description: c.description,
    scope: c.scope.map(resolveEntityId),
    severity: c.severity,
  }));

  const worldModel: WorldModelType = {
    id: genId("wm"),
    name: extraction.model_name || input.name || "Untitled World Model",
    description: extraction.model_description || "Extracted world model",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities,
    relations,
    processes,
    constraints,
    metadata: {
      source_type: input.sourceType,
      source_summary: extraction.source_summary || "No summary",
      confidence: extraction.confidence ?? 0.5,
      extraction_notes: extraction.extraction_notes,
    },
  };

  return Promise.resolve({ input, worldModel });
}
