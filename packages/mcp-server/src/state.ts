import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { Blueprint, CompilerStageCode } from "@swm/compiler";

// ─── World model types ────────────────────────────────────────────────────────

export interface ManifestStageEntry {
  readonly postcode: string;
  readonly artifactPath?: string; // file-based
  readonly sha?: string; // git-backed
}

export interface Manifest {
  readonly runId: string;
  readonly compiledAt: number;
  readonly intent: string;
  readonly decision: string;
  readonly stages: Partial<Record<CompilerStageCode, ManifestStageEntry>>;
  readonly blueprintPostcode: string;
  readonly governorPostcode: string;
}

// ─── Directory resolution ─────────────────────────────────────────────────────

function getProjectDir(): string {
  const explicit = process.env["ADA_PROJECT_DIR"];
  if (explicit) return explicit;
  const statePath = process.env["ADA_STATE_PATH"];
  if (statePath) return path.dirname(statePath);
  const claudeProjectDir = process.env["CLAUDE_PROJECT_DIR"];
  if (claudeProjectDir) return claudeProjectDir;
  return process.cwd();
}

function postcodeToDir(raw: string): string {
  return raw.replace(/\./g, "_").replace(/\//g, "_");
}

// ─── Git utilities ────────────────────────────────────────────────────────────

/**
 * Reads the world model tree SHA from .ada/ref.
 * Format: "ada/v1 <40-char-sha>\n"
 */
function readAdaRef(projectDir: string): string | null {
  try {
    const refPath = path.join(projectDir, ".ada", "ref");
    const content = fs.readFileSync(refPath, "utf8").trim();
    const match = content.match(/^ada\/v1 ([a-f0-9]{40})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads a git blob object by SHA. Returns the raw string content.
 */
function readGitBlob(sha: string, cwd: string): string | null {
  try {
    const r = spawnSync("git", ["cat-file", "blob", sha], {
      cwd,
      encoding: "utf8",
    });
    if (r.status !== 0) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

/**
 * Lists entries in a git tree. Returns { name, sha } pairs.
 */
function listGitTree(
  treeSha: string,
  cwd: string,
): { name: string; sha: string }[] {
  try {
    const r = spawnSync("git", ["ls-tree", treeSha], {
      cwd,
      encoding: "utf8",
    });
    if (r.status !== 0) return [];
    return r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // Format: "<mode> <type> <sha>\t<name>"
        const [, , sha, name] = line.split(/\s+/, 4) as [
          string,
          string,
          string,
          string,
        ];
        return { name: name ?? "", sha: sha ?? "" };
      })
      .filter((e) => e.sha && e.name);
  } catch {
    return [];
  }
}

// ─── Loaders ──────────────────────────────────────────────────────────────────

export function loadBlueprint(): Blueprint | null {
  // ADA_STATE_PATH takes explicit precedence; otherwise fall back to project dir.
  // This ensures query_constraints works in spawned Claude Code sessions where
  // ADA_STATE_PATH is never set — cwd() is the project dir in that context.
  const statePath =
    process.env["ADA_STATE_PATH"] ??
    path.join(getProjectDir(), ".ada", "state.json");

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as { blueprint?: Blueprint };
    return parsed.blueprint ?? null;
  } catch {
    return null;
  }
}

export function loadManifest(): Manifest | null {
  const projectDir = getProjectDir();

  // ── Git-backed path ────────────────────────────────────────────────────────
  const treeSha = readAdaRef(projectDir);
  if (treeSha) {
    try {
      const entries = listGitTree(treeSha, projectDir);
      const manifestEntry = entries.find((e) => e.name === "manifest");
      if (manifestEntry) {
        const raw = readGitBlob(manifestEntry.sha, projectDir);
        if (raw) return JSON.parse(raw) as Manifest;
      }
    } catch {
      // Fall through to file-based
    }
  }

  // ── File-based fallback ────────────────────────────────────────────────────
  try {
    const manifestPath = path.join(projectDir, ".ada", "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

export function loadArtifact(postcode: string): unknown {
  const projectDir = getProjectDir();

  // ── Git-backed path: look up SHA from manifest ─────────────────────────────
  const treeSha = readAdaRef(projectDir);
  if (treeSha) {
    try {
      const manifest = loadManifest();
      if (manifest) {
        for (const entry of Object.values(manifest.stages)) {
          if (entry?.postcode === postcode && entry.sha) {
            const raw = readGitBlob(entry.sha, projectDir);
            if (raw) return JSON.parse(raw);
          }
        }
        // Also search the tree directly by stage code if postcode isn't in manifest
        const treeEntries = listGitTree(treeSha, projectDir);
        const stageEntry = treeEntries.find((e) => {
          const m = manifest.stages[e.name as CompilerStageCode];
          return m?.postcode === postcode;
        });
        if (stageEntry) {
          const raw = readGitBlob(stageEntry.sha, projectDir);
          if (raw) return JSON.parse(raw);
        }
      }
    } catch {
      // Fall through to file-based
    }
  }

  // ── File-based fallback ────────────────────────────────────────────────────
  try {
    const artifactPath = path.join(
      projectDir,
      ".ada",
      "artifacts",
      postcodeToDir(postcode),
      "artifact.json",
    );
    const raw = fs.readFileSync(artifactPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadStageArtifact(stage: CompilerStageCode): unknown {
  const projectDir = getProjectDir();

  // ── Git-backed path: look up stage entry directly from tree ───────────────
  const treeSha = readAdaRef(projectDir);
  if (treeSha) {
    try {
      const entries = listGitTree(treeSha, projectDir);
      const stageEntry = entries.find((e) => e.name === stage);
      if (stageEntry) {
        const raw = readGitBlob(stageEntry.sha, projectDir);
        if (raw) return JSON.parse(raw);
      }
    } catch {
      // Fall through to manifest-based
    }
  }

  // ── Manifest-based fallback (file or git manifest) ─────────────────────────
  const manifest = loadManifest();
  if (!manifest) return null;
  const entry = manifest.stages[stage];
  if (!entry) return null;
  return loadArtifact(entry.postcode);
}
