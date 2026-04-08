import type { WorldModelType } from "../schema/index.js";
import { WorldModel } from "../schema/world-model.js";
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

  // Normalize entity types the LLM may return outside the enum
  const VALID_ENTITY_TYPES = new Set([
    "actor",
    "object",
    "system",
    "concept",
    "location",
    "event",
    "group",
    "resource",
  ]);
  const ENTITY_TYPE_ALIASES: Record<string, string> = {
    person: "actor",
    user: "actor",
    role: "actor",
    agent: "actor",
    organization: "group",
    org: "group",
    team: "group",
    company: "group",
    place: "location",
    area: "location",
    region: "location",
    service: "system",
    platform: "system",
    tool: "system",
    application: "system",
    app: "system",
    idea: "concept",
    principle: "concept",
    pattern: "concept",
    category: "concept",
    item: "object",
    thing: "object",
    product: "object",
    data: "resource",
    asset: "resource",
    file: "resource",
    document: "resource",
    incident: "event",
    action: "event",
    occurrence: "event",
  };
  function normalizeEntityType(
    raw: string,
  ): WorldModelType["entities"][number]["type"] {
    const lower = raw.toLowerCase().trim();
    if (VALID_ENTITY_TYPES.has(lower))
      return lower as WorldModelType["entities"][number]["type"];
    return (ENTITY_TYPE_ALIASES[lower] ??
      "object") as WorldModelType["entities"][number]["type"];
  }

  // Normalize relation types
  const VALID_RELATION_TYPES = new Set([
    "has",
    "is_a",
    "part_of",
    "depends_on",
    "produces",
    "consumes",
    "controls",
    "communicates_with",
    "located_in",
    "triggers",
    "inherits",
    "contains",
    "uses",
    "flows_to",
    "opposes",
    "enables",
    "transforms",
  ]);
  function normalizeRelationType(
    raw: string,
  ): WorldModelType["relations"][number]["type"] {
    const lower = raw.toLowerCase().trim().replace(/ /g, "_");
    if (VALID_RELATION_TYPES.has(lower))
      return lower as WorldModelType["relations"][number]["type"];
    return "uses" as WorldModelType["relations"][number]["type"];
  }

  // Normalize constraint types
  const VALID_CONSTRAINT_TYPES = new Set([
    "invariant",
    "rule",
    "boundary",
    "dependency",
    "capacity",
    "temporal",
    "authorization",
  ]);
  function normalizeConstraintType(
    raw: string,
  ): WorldModelType["constraints"][number]["type"] {
    const lower = raw.toLowerCase().trim().replace(/ /g, "_");
    if (VALID_CONSTRAINT_TYPES.has(lower))
      return lower as WorldModelType["constraints"][number]["type"];
    return "rule" as WorldModelType["constraints"][number]["type"];
  }

  // Build entity name → ID map (case-insensitive + trimmed for robust matching)
  const entityIdMap = new Map<string, string>(); // normalized name → id
  const entityOriginalNames = new Map<string, string>(); // normalized name → original name
  const normalizeForLookup = (name: string) => name.toLowerCase().trim();

  const entities = extraction.entities.map((e) => {
    const id = genId("ent");
    const key = normalizeForLookup(e.name);
    entityIdMap.set(key, id);
    entityOriginalNames.set(key, e.name);
    return {
      id,
      name: e.name,
      type: normalizeEntityType(e.type),
      description: e.description,
      properties: e.properties,
      tags: e.tags,
    };
  });

  const resolveEntityId = (name: string): string => {
    const key = normalizeForLookup(name);
    const existing = entityIdMap.get(key);
    if (existing) return existing;
    // Create a placeholder entity for unresolved references
    const id = genId("ent");
    entityIdMap.set(key, id);
    entityOriginalNames.set(key, name);
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
    type: normalizeRelationType(r.type),
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
    steps: p.steps.map((s, idx) => ({
      order: s.order ?? idx + 1,
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
    type: normalizeConstraintType(c.type),
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

  // Validate output against Zod schema — catch structuring bugs before they propagate
  const parseResult = WorldModel.safeParse(worldModel);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .slice(0, 3)
      .map((i) => i.message)
      .join("; ");
    process.stderr.write(
      `  [structuring] Output failed schema validation: ${issues}\n`,
    );
    // Don't throw — return what we have, validation agent will catch specifics
  }

  return Promise.resolve({ input, worldModel });
}
