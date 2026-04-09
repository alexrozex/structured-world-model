/**
 * World model loading and validation utilities.
 * Provides typed, validated loading from JSON strings, objects, and files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorldModel } from "../schema/world-model.js";
import type { WorldModelType } from "../schema/index.js";

export interface LoadResult {
  model: WorldModelType;
  warnings: string[];
}

/**
 * Parse and validate a world model from a JSON string.
 * Throws with a descriptive error if validation fails.
 */
export function parseWorldModel(json: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return validateWorldModel(raw);
}

/**
 * Validate an unknown object as a WorldModel.
 * Returns the typed model + any warnings about data quality.
 */
export function validateWorldModel(data: unknown): LoadResult {
  const result = WorldModel.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid world model:\n${issues}${result.error.issues.length > 5 ? `\n  ... and ${result.error.issues.length - 5} more` : ""}`,
    );
  }

  const model = result.data;
  const warnings: string[] = [];

  // Quality warnings
  if (model.entities.length === 0) {
    warnings.push("Model has no entities");
  }
  if (model.relations.length === 0 && model.entities.length > 1) {
    warnings.push("Model has entities but no relations — may be incomplete");
  }
  if (!model.metadata) {
    warnings.push("Model has no metadata — source information missing");
  }

  return { model, warnings };
}

/**
 * Load and validate a world model from a JSON file.
 */
export function loadWorldModelFromFile(filePath: string): LoadResult {
  const resolved = resolve(filePath);
  let content: string;
  try {
    content = readFileSync(resolved, "utf-8");
  } catch (e) {
    throw new Error(`Cannot read file: ${resolved}`);
  }
  return parseWorldModel(content);
}
