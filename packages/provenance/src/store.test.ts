import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { ManifoldStore } from './store.js';
import { ManifoldState, SemanticNode } from './manifold.js';
import { generatePostcode } from './postcode.js';

describe("ManifoldStore (Git-backed)", () => {
  const testDir = path.join(process.cwd(), ".ada-test-repo");

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    execSync("git init", { cwd: testDir });
    // Need a commit to make it a "real" repo for some git commands
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync("git commit --allow-empty -m 'initial commit'", { cwd: testDir });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("saves and loads a full ManifoldState from Git", () => {
    const store = new ManifoldStore(testDir);

    const node1: SemanticNode = {
      id: "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/v1",
      coordinate: {
        layer: "L2I",
        concern: "ENT",
        scope: "LOC",
        dimension: "WHT",
        domain: "SFT",
      },
      content: { name: "TestNode" },
      provenance: [],
      entropy: 0.5,
    };

    const state: ManifoldState = {
      ref: "",
      nodes: {
        [node1.id]: node1,
      },
      edges: [
        {
          from: "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/v1",
          to: "TARGET",
          relation: "derives",
        },
      ],
      metrics: {
        totalEntropy: 0.5,
        nodeCount: 1,
        invariantPassRate: 1.0,
      },
    };

    const treeSha = store.saveManifold(state);
    expect(treeSha).toMatch(/^[a-f0-9]{40,}$/);

    const loadedState = store.loadManifold(treeSha);
    expect(loadedState.nodes[node1.id]).toEqual(node1);
    expect(loadedState.edges).toEqual(state.edges);
    expect(loadedState.metrics).toEqual(state.metrics);
    expect(loadedState.ref).toBe(treeSha);
  });

  it("persists the tree SHA to .ada/ref", () => {
    const store = new ManifoldStore(testDir);
    const treeSha = "a".repeat(40); // dummy SHA

    store.saveRef(treeSha);
    expect(store.loadRef()).toBe(treeSha);

    const refContent = fs.readFileSync(path.join(testDir, ".ada", "ref"), "utf8");
    expect(refContent).toBe(`ada/v1 ${treeSha}\n`);
  });
});
