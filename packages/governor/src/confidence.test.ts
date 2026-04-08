/**
 * Unit tests for ConfidenceTracker — pure class, no I/O.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfidenceTracker } from "./confidence.js";

test("starts at 1.0", () => {
  const t = new ConfidenceTracker();
  assert.equal(t.current, 1.0);
});

test("isLow is false at 1.0 (default threshold 0.7)", () => {
  const t = new ConfidenceTracker();
  assert.equal(t.isLow, false);
});

test("onDrift reduces value by 0.10", () => {
  const t = new ConfidenceTracker();
  const after = t.onDrift();
  assert.equal(after, 0.9);
  assert.equal(t.current, 0.9);
});

test("onPostconditionFail reduces value by 0.15", () => {
  const t = new ConfidenceTracker();
  const after = t.onPostconditionFail();
  assert.equal(after, 0.85);
  assert.equal(t.current, 0.85);
});

test("onCorrectionApplied increases value by 0.05", () => {
  const t = new ConfidenceTracker();
  t.onDrift(); // 0.9
  const after = t.onCorrectionApplied();
  assert.ok(Math.abs(after - 0.95) < 0.001, `expected ~0.95, got ${after}`);
});

test("confidence never goes below 0", () => {
  const t = new ConfidenceTracker();
  for (let i = 0; i < 20; i++) t.onDrift();
  assert.equal(t.current, 0);
  assert.ok(t.current >= 0, "confidence cannot be negative");
});

test("confidence never goes above 1.0", () => {
  const t = new ConfidenceTracker();
  for (let i = 0; i < 5; i++) t.onCorrectionApplied();
  assert.equal(t.current, 1.0);
});

test("isLow becomes true after enough drift", () => {
  const t = new ConfidenceTracker(0.7);
  t.onDrift(); // 0.9
  t.onDrift(); // 0.8
  t.onDrift(); // 0.7 — exactly at threshold, NOT below
  assert.equal(t.isLow, false);
  t.onDrift(); // 0.6 — below threshold
  assert.equal(t.isLow, true);
});

test("custom threshold affects isLow", () => {
  const t = new ConfidenceTracker(0.95);
  assert.equal(t.isLow, false);
  t.onDrift(); // 0.9 — below 0.95 threshold
  assert.equal(t.isLow, true);
});

test("accumulated drift and correction mix correctly", () => {
  const t = new ConfidenceTracker();
  t.onDrift(); // 1.0 - 0.10 = 0.90
  t.onPostconditionFail(); // 0.90 - 0.15 = 0.75
  t.onCorrectionApplied(); // 0.75 + 0.05 = 0.80
  t.onDrift(); // 0.80 - 0.10 = 0.70
  assert.ok(
    Math.abs(t.current - 0.7) < 0.001,
    `expected ~0.7, got ${t.current}`,
  );
  assert.equal(t.isLow, false); // exactly at threshold (0.7 < 0.7 is false)
});
