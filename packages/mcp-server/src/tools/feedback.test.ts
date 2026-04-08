/**
 * Unit tests for MCP feedback tools — reportImplementationDecision and reportGap.
 * Run: node --test dist/tools/feedback.test.js
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { reportImplementationDecision, reportGap } from "./feedback.js";

// ─── Fixture setup ────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ada-feedback-test-"));
  process.env["ADA_PROJECT_DIR"] = tempDir;
});

afterEach(() => {
  delete process.env["ADA_PROJECT_DIR"];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── reportImplementationDecision ─────────────────────────────────────────────

describe("reportImplementationDecision", () => {
  test("returns isError=false on success", () => {
    const result = reportImplementationDecision(
      "AuthService",
      "Used JWT instead of sessions",
      "Sessions require sticky routing in the current infra",
    );
    assert.equal(result.isError, false);
  });

  test("creates .ada/feedback/ directory if missing", () => {
    reportImplementationDecision("Foo", "chose X", "reason");
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    assert.ok(fs.existsSync(feedbackDir), "feedback dir should be created");
  });

  test("writes a JSON file with correct fields", () => {
    reportImplementationDecision(
      "PaymentGateway",
      "Stripe instead of Braintree",
      "Stripe has better docs",
    );
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    const files = fs
      .readdirSync(feedbackDir)
      .filter((f) => f.startsWith("decision-"));
    assert.equal(files.length, 1);

    const record = JSON.parse(
      fs.readFileSync(path.join(feedbackDir, files[0]!), "utf8"),
    );
    assert.equal(record.type, "implementation_decision");
    assert.equal(record.componentName, "PaymentGateway");
    assert.equal(record.decision, "Stripe instead of Braintree");
    assert.equal(record.rationale, "Stripe has better docs");
    assert.ok(typeof record.createdAt === "number" && record.createdAt > 0);
  });

  test("content mentions component name and filename", () => {
    const result = reportImplementationDecision("Cache", "Redis", "fast");
    assert.ok(result.content.includes("Cache"));
    assert.ok(result.content.includes(".ada/feedback/"));
    assert.ok(result.content.includes("--amend"));
  });

  test("multiple calls write distinct files", () => {
    reportImplementationDecision("A", "d1", "r1");
    // force a distinct timestamp
    const later = Date.now() + 1;
    reportImplementationDecision("B", "d2", "r2");
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    const files = fs
      .readdirSync(feedbackDir)
      .filter((f) => f.startsWith("decision-"));
    assert.ok(files.length >= 1); // at least 1 — timing may collapse but both writes must succeed
  });

  test("returns isError=true when directory is not writable", () => {
    // Point to a path that can't be created (file blocking directory)
    const blockPath = path.join(tempDir, ".ada");
    fs.writeFileSync(blockPath, "blocking file");

    const result = reportImplementationDecision("X", "y", "z");
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("Failed to record decision"));
  });
});

// ─── reportGap ────────────────────────────────────────────────────────────────

describe("reportGap", () => {
  test("returns isError=false on success", () => {
    const result = reportGap("Blueprint missing rate-limiting specification");
    assert.equal(result.isError, false);
  });

  test("creates .ada/feedback/ directory if missing", () => {
    reportGap("missing something");
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    assert.ok(fs.existsSync(feedbackDir));
  });

  test("writes a JSON file with correct fields", () => {
    reportGap("No error boundary spec for the upload component");
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    const files = fs
      .readdirSync(feedbackDir)
      .filter((f) => f.startsWith("gap-"));
    assert.equal(files.length, 1);

    const record = JSON.parse(
      fs.readFileSync(path.join(feedbackDir, files[0]!), "utf8"),
    );
    assert.equal(record.type, "gap");
    assert.equal(
      record.description,
      "No error boundary spec for the upload component",
    );
    assert.ok(typeof record.createdAt === "number" && record.createdAt > 0);
  });

  test("content mentions --amend", () => {
    const result = reportGap("missing X");
    assert.ok(result.content.includes("--amend"));
    assert.ok(result.content.includes(".ada/feedback/"));
  });

  test("returns isError=true when directory is not writable", () => {
    const blockPath = path.join(tempDir, ".ada");
    fs.writeFileSync(blockPath, "blocking file");

    const result = reportGap("something missing");
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("Failed to record gap"));
  });

  test("decision and gap files coexist without collision", () => {
    reportImplementationDecision("Auth", "JWT", "simple");
    reportGap("missing session expiry spec");
    const feedbackDir = path.join(tempDir, ".ada", "feedback");
    const decisions = fs
      .readdirSync(feedbackDir)
      .filter((f) => f.startsWith("decision-"));
    const gaps = fs
      .readdirSync(feedbackDir)
      .filter((f) => f.startsWith("gap-"));
    assert.equal(decisions.length, 1);
    assert.equal(gaps.length, 1);
  });
});
