import type { WorldModelType } from "../schema/index.js";

/**
 * Export a world model as a CLAUDE.md file — a governing context document
 * that an AI agent can use as its operating reality.
 */
export function toClaudeMd(model: WorldModelType): string {
  const lines: string[] = [];

  lines.push(`# ${model.name}`);
  lines.push("");
  lines.push(model.description);
  lines.push("");
  lines.push(
    `> World model v${model.version} — ${model.entities.length} entities, ${model.relations.length} relations, ${model.processes.length} processes, ${model.constraints.length} constraints`,
  );
  lines.push(`> Confidence: ${model.metadata?.confidence ?? "unknown"}`);
  lines.push("");

  // ─── Domain Entities ────────────────────────────────────
  lines.push("## Domain Entities");
  lines.push("");
  lines.push("The system you are working with has these components:");
  lines.push("");

  const byType = new Map<string, WorldModelType["entities"]>();
  for (const e of model.entities) {
    const arr = byType.get(e.type) ?? [];
    arr.push(e);
    byType.set(e.type, arr);
  }

  for (const [type, entities] of byType) {
    lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
    lines.push("");
    for (const e of entities) {
      lines.push(`- **${e.name}**: ${e.description}`);
      if (e.properties && Object.keys(e.properties).length > 0) {
        for (const [k, v] of Object.entries(e.properties)) {
          lines.push(`  - ${k}: ${JSON.stringify(v)}`);
        }
      }
    }
    lines.push("");
  }

  // ─── Relationships ──────────────────────────────────────
  lines.push("## Relationships");
  lines.push("");
  lines.push("These are the dependencies and connections between components:");
  lines.push("");

  for (const r of model.relations) {
    const src = model.entities.find((e) => e.id === r.source)?.name ?? r.source;
    const tgt = model.entities.find((e) => e.id === r.target)?.name ?? r.target;
    lines.push(
      `- **${src}** ${r.type.replace(/_/g, " ")} **${tgt}**: ${r.label}`,
    );
  }
  lines.push("");

  // ─── Processes ──────────────────────────────────────────
  if (model.processes.length > 0) {
    lines.push("## Processes");
    lines.push("");
    lines.push("When these events occur, follow these sequences:");
    lines.push("");

    for (const p of model.processes) {
      lines.push(`### ${p.name}`);
      lines.push("");
      lines.push(p.description);
      if (p.trigger) {
        lines.push(`**Trigger:** ${p.trigger}`);
      }
      lines.push("");

      for (const step of p.steps) {
        const actor = step.actor
          ? (model.entities.find((e) => e.id === step.actor)?.name ?? "unknown")
          : "system";
        lines.push(`${step.order}. **${actor}**: ${step.action}`);
      }
      lines.push("");

      if (p.outcomes.length > 0) {
        lines.push(`**Outcomes:** ${p.outcomes.join(", ")}`);
        lines.push("");
      }
    }
  }

  // ─── Constraints ────────────────────────────────────────
  if (model.constraints.length > 0) {
    lines.push("## Constraints");
    lines.push("");
    lines.push("You MUST respect these rules at all times:");
    lines.push("");

    const hard = model.constraints.filter((c) => c.severity === "hard");
    const soft = model.constraints.filter((c) => c.severity === "soft");

    if (hard.length > 0) {
      lines.push("### Hard Constraints (violations are errors)");
      lines.push("");
      for (const c of hard) {
        const scopeNames = c.scope
          .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
          .join(", ");
        lines.push(
          `- **${c.name}** (applies to: ${scopeNames}): ${c.description}`,
        );
      }
      lines.push("");
    }

    if (soft.length > 0) {
      lines.push("### Soft Constraints (violations are warnings)");
      lines.push("");
      for (const c of soft) {
        const scopeNames = c.scope
          .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
          .join(", ");
        lines.push(
          `- **${c.name}** (applies to: ${scopeNames}): ${c.description}`,
        );
      }
      lines.push("");
    }
  }

  // ─── Extraction Notes ───────────────────────────────────
  if (
    model.metadata?.extraction_notes &&
    model.metadata.extraction_notes.length > 0
  ) {
    lines.push("## Notes");
    lines.push("");
    lines.push("The following observations were made during model extraction:");
    lines.push("");
    for (const note of model.metadata.extraction_notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
