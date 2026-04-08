import * as fs from "node:fs";
import * as path from "node:path";
import type { CompilerStageCode } from "./types.js";

/**
 * RunStore — persists each compilation run as a versioned directory.
 *
 * Directory layout:
 *   .ada/runs/{runId}/
 *     manifest.json       ← run metadata: intent, status, timings, token totals
 *     CTX.json            ← stage artifact
 *     INT.json
 *     PER.json
 *     ENT.json
 *     PRO.json
 *     SYN.json
 *     VER.json
 *     GOV.json
 *     BLD.json
 *     sub-goals/
 *       {context-name}.json   ← SubGoalSpec per bounded context
 */
export interface RunManifest {
  readonly runId: string;
  readonly intent: string;
  readonly status: "running" | "accepted" | "rejected" | "iterating" | "failed";
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly totalDurationMs?: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly stages: readonly {
    readonly stage: CompilerStageCode;
    readonly completedAt: number;
    readonly durationMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly postcode: string;
  }[];
}

export class RunStore {
  private readonly runsDir: string;

  constructor(adaDir: string) {
    this.runsDir = path.join(adaDir, "runs");
  }

  getRunDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }

  /** Write a single stage's output artifact to disk. */
  writeStageArtifact(
    runId: string,
    stage: CompilerStageCode,
    data: unknown,
  ): void {
    try {
      const runDir = this.getRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, `${stage}.json`),
        JSON.stringify(data, null, 2),
        "utf8",
      );
    } catch {
      /* never crash pipeline for persistence errors */
    }
  }

  /** Write or overwrite the run manifest. */
  writeManifest(runId: string, manifest: RunManifest): void {
    try {
      const runDir = this.getRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
    } catch {
      /* never crash pipeline for persistence errors */
    }
  }

  /** Write a sub-goal spec for a bounded context. */
  writeSubGoal(runId: string, contextName: string, spec: unknown): void {
    try {
      const subDir = path.join(this.getRunDir(runId), "sub-goals");
      fs.mkdirSync(subDir, { recursive: true });
      const safeName = contextName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      fs.writeFileSync(
        path.join(subDir, `${safeName}.json`),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
    } catch {
      /* never crash pipeline for persistence errors */
    }
  }

  /**
   * Write the subGoal execution schedule (waves) produced by scheduleSubGoals.
   * Stored as schedule.json in the run directory.
   */
  writeSchedule(runId: string, schedule: unknown[][]): void {
    try {
      const runDir = this.getRunDir(runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "schedule.json"),
        JSON.stringify(schedule, null, 2),
        "utf8",
      );
    } catch {
      /* never crash pipeline for persistence errors */
    }
  }

  /** Read a prior run manifest, returns null if not found. */
  loadManifest(runId: string): RunManifest | null {
    try {
      const p = path.join(this.getRunDir(runId), "manifest.json");
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8")) as RunManifest;
    } catch {
      return null;
    }
  }

  /** List all run IDs, sorted newest-first. */
  listRuns(): string[] {
    try {
      if (!fs.existsSync(this.runsDir)) return [];
      return fs
        .readdirSync(this.runsDir)
        .filter((d) => {
          const p = path.join(this.runsDir, d, "manifest.json");
          return fs.existsSync(p);
        })
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** Load the latest run manifest, returns null if no runs exist. */
  loadLatest(): RunManifest | null {
    const runs = this.listRuns();
    return runs[0] ? this.loadManifest(runs[0]) : null;
  }
}
