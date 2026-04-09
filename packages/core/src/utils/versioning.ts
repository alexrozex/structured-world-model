/**
 * Model versioning utilities.
 * Bump versions and track changes when models are modified.
 */

import type { WorldModelType } from "../schema/index.js";

export type VersionBump = "patch" | "minor" | "major";

/**
 * Bump a semver version string.
 * "0.1.0" + "patch" → "0.1.1"
 * "0.1.3" + "minor" → "0.2.0"
 * "1.2.3" + "major" → "2.0.0"
 */
export function bumpVersion(
  current: string,
  bump: VersionBump = "patch",
): string {
  const parts = current.split(".").map(Number);
  const [major, minor, patch] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Create a new version of a world model with bumped version and changelog note.
 * Does NOT modify the input — returns a new object.
 */
export function versionModel(
  model: WorldModelType,
  changeDescription: string,
  bump: VersionBump = "patch",
): WorldModelType {
  const newVersion = bumpVersion(model.version ?? "0.1.0", bump);
  const note = `[v${newVersion}] ${changeDescription}`;

  const existingNotes = model.metadata?.extraction_notes ?? [];

  return {
    ...model,
    version: newVersion,
    metadata: model.metadata
      ? {
          ...model.metadata,
          extraction_notes: [...existingNotes, note],
        }
      : undefined,
  };
}

/**
 * Compare two version strings.
 * Returns: -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
