import { ProvenanceStore } from "@swm/provenance";
import * as path from "node:path";

export function logDrift(
  location: string,
  original: string,
  actual: string,
  severity: "critical" | "major" | "minor"
): { content: string; isError: boolean } {
  const statePath = process.env["ADA_STATE_PATH"];
  if (!statePath) {
    return { content: "ADA_STATE_PATH not set.", isError: true };
  }

  try {
    const dbPath = path.join(path.dirname(statePath), "provenance.db");
    const store = new ProvenanceStore(dbPath);
    store.logDrift(location, original, actual, severity);
    store.close();
    return { content: `Drift logged: ${severity} at ${location}`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to log drift: ${message}`, isError: true };
  }
}
