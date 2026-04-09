/**
 * Model serialization utilities.
 * Convert world models to various string formats.
 */

import type { WorldModelType } from "../schema/index.js";
import { stringify as yamlStringify } from "yaml";

/** Compact JSON — no whitespace, minimal size. Good for storage and APIs. */
export function toCompactJSON(model: WorldModelType): string {
  return JSON.stringify(model);
}

/** Pretty JSON — formatted with 2-space indent. Good for humans. */
export function toPrettyJSON(model: WorldModelType): string {
  return JSON.stringify(model, null, 2);
}

/** YAML — human-readable structured format. */
export function toYAML(model: WorldModelType): string {
  return yamlStringify(model);
}

/** Calculate model size metrics. */
export function modelSize(model: WorldModelType): {
  entities: number;
  relations: number;
  processes: number;
  constraints: number;
  totalElements: number;
  jsonBytes: number;
} {
  const entities = model.entities.length;
  const relations = model.relations.length;
  const processes = model.processes.length;
  const constraints = model.constraints.length;
  return {
    entities,
    relations,
    processes,
    constraints,
    totalElements: entities + relations + processes + constraints,
    jsonBytes: Buffer.byteLength(JSON.stringify(model), "utf-8"),
  };
}
