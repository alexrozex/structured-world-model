/**
 * Unit tests for analyzeCodebase / walkTs — CTX stage contamination fix.
 * Run: node --test dist/context/analyzer.test.js
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { walkTs, analyzeCodebase } from "./analyzer.js";

// ─── Temp dir helpers ─────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ada-analyzer-test-"));
}

function writeTsFile(dir: string, relPath: string, content: string): string {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── walkTs — excluded directories ───────────────────────────────────────────

describe("walkTs — excluded directories", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTempDir();
    // Create TS files in various directories
    writeTsFile(tmpDir, "src/types.ts", "export interface Foo { id: string }");
    writeTsFile(
      tmpDir,
      "node_modules/some-pkg/index.ts",
      "export type Bar = string",
    );
    writeTsFile(tmpDir, ".ada/artifacts/blueprint.ts", "export const x = 1");
    writeTsFile(tmpDir, ".git/hooks/pre-commit.ts", "export const y = 2");
    writeTsFile(
      tmpDir,
      ".claude/agents/MyAgent.ts",
      "export interface AgentOutput {}",
    );
  });

  after(() => {
    removeDir(tmpDir);
  });

  test("walkTs excludes node_modules directories", () => {
    const files = walkTs(tmpDir);
    const hasNodeModules = files.some((f) => f.includes("node_modules"));
    assert.ok(
      !hasNodeModules,
      "walkTs must not return files from node_modules",
    );
  });

  test("walkTs excludes .ada directories", () => {
    const files = walkTs(tmpDir);
    const hasAda = files.some((f) => f.includes(path.sep + ".ada" + path.sep));
    assert.ok(!hasAda, "walkTs must not return files from .ada directories");
  });

  test("walkTs excludes .git directories", () => {
    const files = walkTs(tmpDir);
    const hasGit = files.some((f) => f.includes(path.sep + ".git" + path.sep));
    assert.ok(!hasGit, "walkTs must not return files from .git directories");
  });

  test("walkTs excludes .claude directories", () => {
    const files = walkTs(tmpDir);
    const hasClaude = files.some((f) =>
      f.includes(path.sep + ".claude" + path.sep),
    );
    assert.ok(
      !hasClaude,
      "walkTs must not return files from .claude directories",
    );
  });

  test("walkTs returns .ts files from non-excluded directories", () => {
    const files = walkTs(tmpDir);
    assert.ok(files.length >= 1, "must return at least one TS file");
    assert.ok(
      files.some((f) => f.includes("src") && f.endsWith("types.ts")),
      "src/types.ts must be included",
    );
  });

  test("walkTs excludes .d.ts declaration files", () => {
    const declDir = makeTempDir();
    try {
      writeTsFile(declDir, "src/types.d.ts", "export type Foo = string");
      writeTsFile(declDir, "src/impl.ts", "export const x = 1");
      const files = walkTs(declDir);
      const hasDts = files.some((f) => f.endsWith(".d.ts"));
      assert.ok(!hasDts, "walkTs must not return .d.ts files");
      assert.ok(
        files.some((f) => f.endsWith("impl.ts")),
        "regular .ts files must be included",
      );
    } finally {
      removeDir(declDir);
    }
  });

  test("walkTs returns empty array for non-existent directory", () => {
    const nonExistent = path.join(os.tmpdir(), "ada-nonexistent-xyz-12345");
    const files = walkTs(nonExistent);
    assert.deepEqual(files, []);
  });
});

// ─── walkTs — custom excludeNames ─────────────────────────────────────────────

describe("walkTs — custom excludeNames", () => {
  test("custom exclude set is respected", () => {
    const tmpDir = makeTempDir();
    try {
      writeTsFile(tmpDir, "src/main.ts", "export const x = 1");
      writeTsFile(tmpDir, "custom-excluded/types.ts", "export interface Y {}");

      const customExclude = new Set(["custom-excluded"]);
      const files = walkTs(tmpDir, customExclude);

      const hasCustom = files.some((f) => f.includes("custom-excluded"));
      const hasSrc = files.some((f) => f.includes("main.ts"));
      assert.ok(!hasCustom, "custom-excluded dir must be skipped");
      assert.ok(hasSrc, "src/main.ts must be included");
    } finally {
      removeDir(tmpDir);
    }
  });
});

// ─── analyzeCodebase — selfCompile flag ───────────────────────────────────────

describe("analyzeCodebase — type registry output", () => {
  test("analyzeCodebase finds types from src/ directory", () => {
    const tmpDir = makeTempDir();
    try {
      // Minimal monorepo-like structure: single src dir, no packages/
      writeTsFile(
        tmpDir,
        "src/types.ts",
        `
export interface OrderItem {
  readonly id: string;
  readonly quantity: number;
}

export type OrderStatus = "pending" | "complete" | "cancelled";
`,
      );

      const ctx = analyzeCodebase(tmpDir);
      assert.ok(
        ctx.vocabulary.includes("OrderItem"),
        "OrderItem must be in vocabulary",
      );
      assert.ok(
        ctx.vocabulary.includes("OrderStatus"),
        "OrderStatus must be in vocabulary",
      );
    } finally {
      removeDir(tmpDir);
    }
  });

  test("analyzeCodebase does not include types from excluded dirs", () => {
    const tmpDir = makeTempDir();
    try {
      writeTsFile(
        tmpDir,
        "src/types.ts",
        "export interface RealType { id: string }",
      );
      writeTsFile(
        tmpDir,
        "node_modules/pkg/types.ts",
        "export interface ShouldNotAppear { x: number }",
      );
      writeTsFile(
        tmpDir,
        ".ada/artifacts/gen.ts",
        "export interface AdaInternal { y: number }",
      );

      const ctx = analyzeCodebase(tmpDir);
      assert.ok(ctx.vocabulary.includes("RealType"), "RealType must be found");
      assert.ok(
        !ctx.vocabulary.includes("ShouldNotAppear"),
        "node_modules types must not appear in vocabulary",
      );
      assert.ok(
        !ctx.vocabulary.includes("AdaInternal"),
        ".ada types must not appear in vocabulary",
      );
    } finally {
      removeDir(tmpDir);
    }
  });

  test("analyzeCodebase returns empty result for empty project", () => {
    const tmpDir = makeTempDir();
    try {
      const ctx = analyzeCodebase(tmpDir);
      assert.deepEqual(ctx.vocabulary, []);
      assert.deepEqual(ctx.constants, []);
    } finally {
      removeDir(tmpDir);
    }
  });

  test("analyzeCodebase vocabulary is sorted", () => {
    const tmpDir = makeTempDir();
    try {
      writeTsFile(
        tmpDir,
        "src/types.ts",
        `
export interface Zebra { id: string }
export interface Apple { name: string }
export interface Mango { color: string }
`,
      );

      const ctx = analyzeCodebase(tmpDir);
      const vocab = ctx.vocabulary.filter((v) =>
        ["Zebra", "Apple", "Mango"].includes(v),
      );
      assert.deepEqual(vocab, [...vocab].sort(), "vocabulary must be sorted");
    } finally {
      removeDir(tmpDir);
    }
  });

  test("analyzeCodebase postcode is stable for same content", () => {
    const tmpDir1 = makeTempDir();
    const tmpDir2 = makeTempDir();
    try {
      const content = "export interface StableType { id: string }";
      writeTsFile(tmpDir1, "src/types.ts", content);
      writeTsFile(tmpDir2, "src/types.ts", content);

      const ctx1 = analyzeCodebase(tmpDir1);
      const ctx2 = analyzeCodebase(tmpDir2);
      assert.equal(
        ctx1.postcode.raw,
        ctx2.postcode.raw,
        "same content must produce same postcode",
      );
    } finally {
      removeDir(tmpDir1);
      removeDir(tmpDir2);
    }
  });

  test("analyzeCodebase extracts constants from ts files", () => {
    const tmpDir = makeTempDir();
    try {
      writeTsFile(
        tmpDir,
        "src/constants.ts",
        `
export const MAX_RETRIES = 3;
export const API_VERSION = "v2";
`,
      );

      const ctx = analyzeCodebase(tmpDir);
      const constNames = ctx.constants.map((c) => c.name);
      assert.ok(
        constNames.includes("MAX_RETRIES"),
        "MAX_RETRIES must be extracted",
      );
      assert.ok(
        constNames.includes("API_VERSION"),
        "API_VERSION must be extracted",
      );
    } finally {
      removeDir(tmpDir);
    }
  });
});
