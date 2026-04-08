import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * GitObjectStore: Low-level utility for interacting with Git's object store.
 * Treats Git as a content-addressed database for the semantic world model.
 */
export class GitObjectStore {
  private readonly gitDir: string;

  constructor(projectDir: string) {
    // Try to find the .git directory starting from projectDir
    const dotGit = this.findDotGit(projectDir);
    if (!dotGit) {
      throw new Error(`Not a git repository: ${projectDir}`);
    }
    this.gitDir = dotGit;
  }

  private findDotGit(startDir: string): string | null {
    let current = startDir;
    while (current !== path.dirname(current)) {
      const dotGit = path.join(current, ".git");
      if (fs.existsSync(dotGit)) return dotGit;
      current = path.dirname(current);
    }
    return null;
  }

  /** Write a blob to the git object store and return its SHA */
  writeBlob(content: string): string {
    return execSync("git hash-object -w --stdin", {
      input: content,
      encoding: "utf8",
    }).trim();
  }

  /** Read a blob's content by its SHA */
  readBlob(sha: string): string {
    return execSync(`git cat-file blob ${sha}`, { encoding: "utf8" });
  }

  /**
   * Write a tree object from a mapping of names to SHAs.
   * Format: Record<"node_coordinate", "blob_sha">
   */
  writeTree(entries: Record<string, string>): string {
    const input = Object.entries(entries)
      .map(([name, sha]) => `100644 blob ${sha}\t${name}`)
      .join("\n");

    return execSync("git mktree", {
      input: input + "\n",
      encoding: "utf8",
    }).trim();
  }

  /** Read a tree object and return a name -> SHA mapping */
  readTree(treeSha: string): Record<string, string> {
    const output = execSync(`git ls-tree ${treeSha}`, { encoding: "utf8" });
    const result: Record<string, string> = {};

    output
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => {
        // Format: 100644 blob <sha>    <name>
        const match = line.match(/^\d+ \w+ ([a-f0-9]{40,})\t(.+)$/);
        if (match) {
          result[match[2]!] = match[1]!;
        }
      });

    return result;
  }
}
