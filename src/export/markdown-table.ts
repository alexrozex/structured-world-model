import type { WorldModelType } from "../schema/index.js";

/**
 * Export a world model as markdown tables — pasteable into docs, PRs, wikis.
 */
export function toMarkdownTable(model: WorldModelType): string {
  const lines: string[] = [];

  lines.push(`# ${model.name}\n`);
  lines.push(`${model.description}\n`);

  // Entities
  lines.push("## Entities\n");
  lines.push("| Name | Type | Description | Confidence |");
  lines.push("|------|------|-------------|------------|");
  for (const e of model.entities) {
    const conf =
      e.confidence !== undefined ? `${Math.round(e.confidence * 100)}%` : "—";
    const desc = e.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${e.name} | ${e.type} | ${desc} | ${conf} |`);
  }

  // Relations
  if (model.relations.length > 0) {
    lines.push("\n## Relations\n");
    lines.push("| Source | Type | Target | Label |");
    lines.push("|--------|------|--------|-------|");
    for (const r of model.relations) {
      const src =
        model.entities.find((e) => e.id === r.source)?.name ?? r.source;
      const tgt =
        model.entities.find((e) => e.id === r.target)?.name ?? r.target;
      const label = (r.label ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${src} | ${r.type} | ${tgt} | ${label} |`);
    }
  }

  // Processes
  if (model.processes.length > 0) {
    lines.push("\n## Processes\n");
    for (const p of model.processes) {
      lines.push(`### ${p.name}\n`);
      lines.push(`${p.description}\n`);
      if (p.trigger) lines.push(`**Trigger:** ${p.trigger}\n`);
      lines.push("| Step | Actor | Action |");
      lines.push("|------|-------|--------|");
      for (const s of p.steps) {
        const actor = s.actor
          ? (model.entities.find((e) => e.id === s.actor)?.name ?? "?")
          : "—";
        lines.push(`| ${s.order} | ${actor} | ${s.action} |`);
      }
      lines.push(`\n**Outcomes:** ${p.outcomes.join(", ")}\n`);
    }
  }

  // Constraints
  if (model.constraints.length > 0) {
    lines.push("\n## Constraints\n");
    lines.push("| Name | Type | Severity | Description | Scope |");
    lines.push("|------|------|----------|-------------|-------|");
    for (const c of model.constraints) {
      const scope = c.scope
        .map((id) => model.entities.find((e) => e.id === id)?.name ?? id)
        .join(", ");
      const desc = c.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(
        `| ${c.name} | ${c.type} | ${c.severity} | ${desc} | ${scope} |`,
      );
    }
  }

  return lines.join("\n");
}
