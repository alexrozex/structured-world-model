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
