import * as fs from "node:fs";

// better-sqlite3 is optional — only needed for legacy ProvenanceStore.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;
try {
  const mod = await import("better-sqlite3");
  Database = mod.default ?? mod;
} catch {
  Database = null;
}
import * as path from "node:path";
import { PostcodeAddress } from "./postcode.js";
import { GitObjectStore } from "./git-store.js";
import { ManifoldState, SemanticNode } from "./manifold.js";

export interface ProvenanceRecord {
  readonly postcode: string;
  readonly stage: string;
  readonly upstreamPostcodes: readonly string[];
  readonly content: string;
  readonly timestamp: number;
}

/**
 * ManifoldStore: Manages the world model persistence using Git's object store
 * and a local pointer file (.ada/ref).
 */
export class ManifoldStore {
  private readonly gitStore: GitObjectStore;
  private readonly refPath: string;

  constructor(projectDir: string) {
    this.gitStore = new GitObjectStore(projectDir);
    this.refPath = path.join(projectDir, ".ada", "ref");
    if (!fs.existsSync(path.dirname(this.refPath))) {
      fs.mkdirSync(path.dirname(this.refPath), { recursive: true });
    }
  }

  /** Read the current pointer from .ada/ref */
  loadRef(): string | null {
    if (!fs.existsSync(this.refPath)) return null;
    const content = fs.readFileSync(this.refPath, "utf8").trim();
    // Format: "ada/v1 <tree-sha>"
    const match = content.match(/^ada\/v1 ([a-f0-9]{40,})$/);
    return match ? match[1]! : null;
  }

  /** Write the current pointer to .ada/ref */
  saveRef(treeSha: string): void {
    fs.writeFileSync(this.refPath, `ada/v1 ${treeSha}\n`, "utf8");
  }

  /** Save a full ManifoldState to the Git object store */
  saveManifold(state: ManifoldState): string {
    const entries: Record<string, string> = {};

    // Write all nodes as blobs
    for (const [id, node] of Object.entries(state.nodes)) {
      // Use the coordinate as the tree entry name (sanitized)
      const entryName = id.replace(/ML\./g, "").replace(/\//g, "_");
      const blobSha = this.gitStore.writeBlob(JSON.stringify(node, null, 2));
      entries[entryName] = blobSha;
    }

    // Write the state manifest (including edges and metrics) as a special entry
    const manifestBlobSha = this.gitStore.writeBlob(
      JSON.stringify(
        {
          edges: state.edges,
          metrics: state.metrics,
        },
        null,
        2,
      ),
    );
    entries["MANIFEST"] = manifestBlobSha;

    const treeSha = this.gitStore.writeTree(entries);
    this.saveRef(treeSha);
    return treeSha;
  }

  /** Load a ManifoldState from the Git object store */
  loadManifold(treeSha: string): ManifoldState {
    const entries = this.gitStore.readTree(treeSha);
    const nodes: Record<string, SemanticNode> = {};

    const manifestSha = entries["MANIFEST"];
    if (!manifestSha) throw new Error("Manifest missing in tree");

    const manifestJson = JSON.parse(this.gitStore.readBlob(manifestSha));

    for (const [name, sha] of Object.entries(entries)) {
      if (name === "MANIFEST") continue;
      const nodeJson = JSON.parse(this.gitStore.readBlob(sha)) as SemanticNode;
      nodes[nodeJson.id] = nodeJson;
    }

    return {
      ref: treeSha,
      nodes,
      edges: manifestJson.edges,
      metrics: manifestJson.metrics,
    };
  }
}

/** Legacy ProvenanceStore (kept for SQLite backward compatibility) */
export class ProvenanceStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any;

  constructor(dbPath: string) {
    if (!Database) {
      throw new Error(
        "better-sqlite3 is not installed — provenance store unavailable.",
      );
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provenance (
        postcode TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        upstream_postcodes TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drift_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location TEXT NOT NULL,
        original TEXT NOT NULL,
        actual TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
        timestamp INTEGER NOT NULL
      );
    `);
  }

  record(
    address: PostcodeAddress,
    upstreamPostcodes: readonly string[],
    content: string,
  ): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO provenance (postcode, stage, upstream_postcodes, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(
        address.raw,
        "LEGACY", // Simplified for new PostcodeAddress structure
        JSON.stringify(upstreamPostcodes),
        content,
        Date.now(),
      );
  }

  get(postcode: string): ProvenanceRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM provenance WHERE postcode = ?")
      .get(postcode) as
      | {
          postcode: string;
          stage: string;
          upstream_postcodes: string;
          content: string;
          timestamp: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      postcode: row.postcode,
      stage: row.stage,
      upstreamPostcodes: JSON.parse(row.upstream_postcodes) as string[],
      content: row.content,
      timestamp: row.timestamp,
    };
  }

  getChain(postcode: string): ProvenanceRecord[] {
    const chain: ProvenanceRecord[] = [];
    const visited = new Set<string>();
    const queue = [postcode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const record = this.get(current);
      if (record) {
        chain.push(record);
        for (const upstream of record.upstreamPostcodes) {
          queue.push(upstream);
        }
      }
    }
    return chain;
  }

  isChainIntact(postcode: string): boolean {
    const chain = this.getChain(postcode);
    if (chain.length === 0) return false;
    for (const record of chain) {
      for (const upstream of record.upstreamPostcodes) {
        if (!this.get(upstream)) return false;
      }
    }
    return true;
  }

  logDrift(
    location: string,
    original: string,
    actual: string,
    severity: "critical" | "major" | "minor",
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO drift_log (location, original, actual, severity, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(location, original, actual, severity, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
