import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Governor } from './governor.js';
import { createGovernedCanUseTool } from './interceptor.js';
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { ManifoldStore, SemanticNode } from "@swm/provenance";

describe("Governor & Interceptor Integration", () => {
  const testDir = path.join(process.cwd(), ".ada-test-gov");

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    execSync("git init", { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync("git commit --allow-empty -m 'initial commit'", { cwd: testDir });
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("blocks tool calls that violate manifold invariants", async () => {
    const store = new ManifoldStore(testDir);
    const governor = new Governor(testDir);

    // Setup manifold with an invariant in a bounded context
    const contextNode: SemanticNode = {
      id: "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/v1",
      coordinate: {
        layer: "L2I",
        concern: "ENT",
        scope: "LOC",
        dimension: "WHT",
        domain: "SFT",
      },
      content: {
        name: "Payments",
        invariants: [{ predicate: "amount > 0" }],
      },
      provenance: [],
      entropy: 0.1,
    };

    store.saveManifold({
      ref: "",
      nodes: { [contextNode.id]: contextNode },
      edges: [],
      metrics: { totalEntropy: 0.1, nodeCount: 1, invariantPassRate: 1.0 },
    });

    // Mock tool call to write_file in the Payments context with invalid input
    const tool = { name: "write_file" };
    const input = { file_path: "src/Payments/transaction.json", amount: -100 };
    const originalCanUseTool = vi.fn().mockResolvedValue({ behavior: "allow" });

    const governedCanUseTool = createGovernedCanUseTool(governor, originalCanUseTool);

    const result = await governedCanUseTool(tool, input, {}, {}, "tool-123");

    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("Manifold Invariant Violation");
    expect(result.decisionReason.reason).toBe("amount > 0");
    expect(originalCanUseTool).not.toHaveBeenCalled();
  });

  it("permits tool calls that satisfy manifold invariants", async () => {
    const governor = new Governor(testDir);
    const tool = { name: "write_file" };
    const input = { file_path: "src/Payments/transaction.json", amount: 100 };
    const originalCanUseTool = vi.fn().mockResolvedValue({ behavior: "allow" });

    const governedCanUseTool = createGovernedCanUseTool(governor, originalCanUseTool);

    const result = await governedCanUseTool(tool, input, {}, {}, "tool-456");

    expect(result.behavior).toBe("allow");
    expect(originalCanUseTool).toHaveBeenCalled();
  });
});
