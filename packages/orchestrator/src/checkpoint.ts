import * as fs from "node:fs";
import type { SessionCheckpoint } from "./types.js";

export function writeCheckpoint(checkpoint: SessionCheckpoint): void {
  const statePath = process.env["ADA_STATE_PATH"];
  if (!statePath) return;

  fs.writeFileSync(statePath, JSON.stringify(checkpoint, null, 2), "utf8");
}

export function readCheckpoint(): SessionCheckpoint | null {
  const statePath = process.env["ADA_STATE_PATH"];
  if (!statePath) return null;

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw) as SessionCheckpoint;
  } catch {
    return null;
  }
}
