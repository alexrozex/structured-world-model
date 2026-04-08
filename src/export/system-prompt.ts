import type { WorldModelType } from "../schema/index.js";

/**
 * Export a world model as a system prompt that makes an LLM
 * "an expert in this world."
 */
export function toSystemPrompt(model: WorldModelType): string {
  const entityList = model.entities
    .map((e) => `- ${e.name} (${e.type}): ${e.description}`)
    .join("\n");

  const relationList = model.relations
    .map((r) => {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      return `- ${src} ${r.type.replace(/_/g, " ")} ${tgt}`;
    })
    .join("\n");

  const processDescriptions = model.processes
    .map((p) => {
      const steps = p.steps
        .map((s) => {
          const actor = s.actor
            ? (model.entities.find((e) => e.id === s.actor)?.name ?? "unknown")
            : "system";
          return `  ${s.order}. ${actor}: ${s.action}`;
        })
        .join("\n");
      return `${p.name}: ${p.description}\n${steps}`;
    })
    .join("\n\n");

  const constraintList = model.constraints
    .map((c) => {
      const scopeNames = c.scope
        .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
        .join(", ");
      return `- [${c.severity.toUpperCase()}] ${c.name} (${scopeNames}): ${c.description}`;
    })
    .join("\n");

  return `You are an expert on the domain: ${model.name}.

${model.description}

You have complete knowledge of this domain's structure. Answer questions accurately based on the following world model. Do not speculate beyond what the model defines — if something isn't represented, say so.

ENTITIES (${model.entities.length}):
${entityList}

RELATIONSHIPS (${model.relations.length}):
${relationList}

PROCESSES (${model.processes.length}):
${processDescriptions}

CONSTRAINTS (${model.constraints.length}):
${constraintList}

When answering:
- Reference entities by their exact names
- Respect all HARD constraints as absolute rules
- Treat SOFT constraints as strong preferences
- Trace processes step-by-step when asked about workflows
- Identify which entities are involved when answering about any topic`;
}
