import type { WorldModelType } from "../schema/index.js";
import { diffWorldModels, type WorldModelDiff } from "./merge.js";
import { genId } from "./ids.js";

export interface Snapshot {
  id: string;
  timestamp: string;
  label?: string;
  model: WorldModelType;
  diff_from_previous?: WorldModelDiff;
  stats: {
    entities: number;
    relations: number;
    processes: number;
    constraints: number;
  };
}

export interface Timeline {
  id: string;
  name: string;
  description: string;
  created_at: string;
  snapshots: Snapshot[];
}

/**
 * Create a new empty timeline.
 */
export function createTimeline(name: string, description?: string): Timeline {
  return {
    id: genId("tl"),
    name,
    description: description ?? `Timeline for ${name}`,
    created_at: new Date().toISOString(),
    snapshots: [],
  };
}

/**
 * Add a world model as a new snapshot to a timeline.
 * Automatically computes diff from the previous snapshot.
 */
export function addSnapshot(
  timeline: Timeline,
  model: WorldModelType,
  label?: string,
): Timeline {
  const previous =
    timeline.snapshots.length > 0
      ? timeline.snapshots[timeline.snapshots.length - 1]
      : null;

  const diff = previous ? diffWorldModels(previous.model, model) : undefined;

  const snapshot: Snapshot = {
    id: genId("snap"),
    timestamp: new Date().toISOString(),
    label,
    model,
    diff_from_previous: diff,
    stats: {
      entities: model.entities.length,
      relations: model.relations.length,
      processes: model.processes.length,
      constraints: model.constraints.length,
    },
  };

  return {
    ...timeline,
    snapshots: [...timeline.snapshots, snapshot],
  };
}

/**
 * Get the history of a specific entity across all snapshots.
 * Returns when it appeared, disappeared, or changed description.
 */
export function entityHistory(
  timeline: Timeline,
  entityName: string,
): Array<{
  snapshot_id: string;
  timestamp: string;
  label?: string;
  event: "appeared" | "disappeared" | "modified" | "unchanged";
  description?: string;
}> {
  const history: Array<{
    snapshot_id: string;
    timestamp: string;
    label?: string;
    event: "appeared" | "disappeared" | "modified" | "unchanged";
    description?: string;
  }> = [];

  const normalizedName = entityName.toLowerCase();
  let previousEntity: { name: string; description: string } | null = null;

  for (const snap of timeline.snapshots) {
    const entity = snap.model.entities.find(
      (e) => e.name.toLowerCase() === normalizedName,
    );

    if (entity && !previousEntity) {
      history.push({
        snapshot_id: snap.id,
        timestamp: snap.timestamp,
        label: snap.label,
        event: "appeared",
        description: entity.description,
      });
    } else if (!entity && previousEntity) {
      history.push({
        snapshot_id: snap.id,
        timestamp: snap.timestamp,
        label: snap.label,
        event: "disappeared",
      });
    } else if (entity && previousEntity) {
      if (entity.description !== previousEntity.description) {
        history.push({
          snapshot_id: snap.id,
          timestamp: snap.timestamp,
          label: snap.label,
          event: "modified",
          description: entity.description,
        });
      } else {
        history.push({
          snapshot_id: snap.id,
          timestamp: snap.timestamp,
          label: snap.label,
          event: "unchanged",
        });
      }
    }

    previousEntity = entity
      ? { name: entity.name, description: entity.description }
      : null;
  }

  return history;
}

/**
 * Get a summary of how the timeline has evolved.
 */
export function timelineSummary(timeline: Timeline): string {
  const lines: string[] = [];
  lines.push(`Timeline: ${timeline.name}`);
  lines.push(`Snapshots: ${timeline.snapshots.length}`);
  lines.push("");

  for (const snap of timeline.snapshots) {
    const diffStr = snap.diff_from_previous
      ? ` (${snap.diff_from_previous.summary})`
      : " (initial)";
    lines.push(
      `  ${snap.timestamp} ${snap.label ?? ""} — ${snap.stats.entities} entities, ${snap.stats.relations} relations${diffStr}`,
    );
  }

  if (timeline.snapshots.length >= 2) {
    const first = timeline.snapshots[0];
    const last = timeline.snapshots[timeline.snapshots.length - 1];
    lines.push("");
    lines.push(
      `Growth: ${first.stats.entities} → ${last.stats.entities} entities, ${first.stats.relations} → ${last.stats.relations} relations`,
    );
  }

  return lines.join("\n");
}

/**
 * Generate a human-readable changelog between two snapshots in a timeline.
 * Shows entities added/removed/changed, relations added/removed, processes added/removed,
 * and overall stats.
 */
export function snapshotChangelog(
  timeline: Timeline,
  fromIndex: number,
  toIndex: number,
): string {
  if (fromIndex < 0 || fromIndex >= timeline.snapshots.length) {
    throw new Error(
      `fromIndex ${fromIndex} out of range (0..${timeline.snapshots.length - 1})`,
    );
  }
  if (toIndex < 0 || toIndex >= timeline.snapshots.length) {
    throw new Error(
      `toIndex ${toIndex} out of range (0..${timeline.snapshots.length - 1})`,
    );
  }

  const fromSnap = timeline.snapshots[fromIndex];
  const toSnap = timeline.snapshots[toIndex];
  const fromModel = fromSnap.model;
  const toModel = toSnap.model;

  // Build entity maps keyed by lowercased name
  const fromEntities = new Map(
    fromModel.entities.map((e) => [e.name.toLowerCase().trim(), e]),
  );
  const toEntities = new Map(
    toModel.entities.map((e) => [e.name.toLowerCase().trim(), e]),
  );

  // Entities
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ name: string; changes: string[] }> = [];

  for (const [key, ent] of toEntities) {
    if (!fromEntities.has(key)) {
      added.push(ent.name);
    } else {
      const prev = fromEntities.get(key)!;
      const changes: string[] = [];
      if (prev.description !== ent.description) {
        changes.push(
          `description: "${prev.description}" -> "${ent.description}"`,
        );
      }
      if (prev.type !== ent.type) {
        changes.push(`type: ${prev.type} -> ${ent.type}`);
      }
      if (changes.length > 0) {
        changed.push({ name: ent.name, changes });
      }
    }
  }

  for (const [key, ent] of fromEntities) {
    if (!toEntities.has(key)) {
      removed.push(ent.name);
    }
  }

  // Relations: compare by source+target+type key
  function relKey(r: WorldModelType["relations"][number]): string {
    return `${r.source}|${r.target}|${r.type}`;
  }
  const fromRelKeys = new Set(fromModel.relations.map(relKey));
  const toRelKeys = new Set(toModel.relations.map(relKey));
  const relationsAdded = toModel.relations.filter(
    (r) => !fromRelKeys.has(relKey(r)),
  );
  const relationsRemoved = fromModel.relations.filter(
    (r) => !toRelKeys.has(relKey(r)),
  );

  // Processes: compare by lowercased name
  const fromProcs = new Set(
    fromModel.processes.map((p) => p.name.toLowerCase().trim()),
  );
  const toProcs = new Set(
    toModel.processes.map((p) => p.name.toLowerCase().trim()),
  );
  const procsAdded = toModel.processes.filter(
    (p) => !fromProcs.has(p.name.toLowerCase().trim()),
  );
  const procsRemoved = fromModel.processes.filter(
    (p) => !toProcs.has(p.name.toLowerCase().trim()),
  );

  // Build output
  const lines: string[] = [];
  const fromLabel = fromSnap.label ? ` (${fromSnap.label})` : "";
  const toLabel = toSnap.label ? ` (${toSnap.label})` : "";
  lines.push(
    `# Changelog: snapshot ${fromIndex}${fromLabel} -> ${toIndex}${toLabel}`,
  );
  lines.push("");

  const hasEntityChanges =
    added.length > 0 || removed.length > 0 || changed.length > 0;
  const hasRelationChanges =
    relationsAdded.length > 0 || relationsRemoved.length > 0;
  const hasProcessChanges = procsAdded.length > 0 || procsRemoved.length > 0;

  if (!hasEntityChanges && !hasRelationChanges && !hasProcessChanges) {
    lines.push("No changes detected.");
    return lines.join("\n");
  }

  if (hasEntityChanges) {
    lines.push("## Entities");
    lines.push("");
    for (const name of added) {
      lines.push(`- **+ ${name}** (added)`);
    }
    for (const name of removed) {
      lines.push(`- **- ${name}** (removed)`);
    }
    for (const { name, changes } of changed) {
      lines.push(`- **~ ${name}** (changed: ${changes.join(", ")})`);
    }
    lines.push("");
  }

  if (hasRelationChanges) {
    lines.push("## Relations");
    lines.push("");
    for (const r of relationsAdded) {
      lines.push(
        `- **+** ${r.source} --[${r.type}]--> ${r.target}: ${r.label}`,
      );
    }
    for (const r of relationsRemoved) {
      lines.push(
        `- **-** ${r.source} --[${r.type}]--> ${r.target}: ${r.label}`,
      );
    }
    lines.push("");
  }

  if (hasProcessChanges) {
    lines.push("## Processes");
    lines.push("");
    for (const p of procsAdded) {
      lines.push(`- **+ ${p.name}**: ${p.description}`);
    }
    for (const p of procsRemoved) {
      lines.push(`- **- ${p.name}**: ${p.description}`);
    }
    lines.push("");
  }

  lines.push("## Stats");
  lines.push("");
  lines.push(
    `- Entities: +${added.length} / -${removed.length} / ~${changed.length} changed`,
  );
  lines.push(
    `- Relations: +${relationsAdded.length} / -${relationsRemoved.length}`,
  );
  lines.push(`- Processes: +${procsAdded.length} / -${procsRemoved.length}`);

  return lines.join("\n");
}
