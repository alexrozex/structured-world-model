import * as fs from "node:fs";
import { generatePostcode } from "@swm/provenance";
import type { Blueprint, IntentGraph } from "../types.js";
import { scanCodebase } from "./codebase-scanner.js";
import { diffBlueprintAgainstCode } from "./blueprint-differ.js";
import type { VerificationReport } from "./types.js";

export interface VerifyOptions {
  readonly projectRoot: string;
  readonly statePath?: string;
}

interface StateFile {
  blueprint?: Blueprint;
  pipelineState?: {
    intent?: IntentGraph;
  };
}

export function loadBlueprintState(statePath: string): {
  blueprint: Blueprint;
  intentGraph: IntentGraph;
} {
  const raw = fs.readFileSync(statePath, "utf8");
  const state = JSON.parse(raw) as StateFile;

  if (!state.blueprint) {
    throw new Error("State file has no blueprint — run 'ada init' first");
  }

  const intentGraph = state.pipelineState?.intent;
  if (!intentGraph) {
    throw new Error(
      "State file has no intent graph — blueprint may be corrupt",
    );
  }

  return { blueprint: state.blueprint, intentGraph };
}

export function verify(options: VerifyOptions): VerificationReport {
  const statePath = options.statePath ?? ".ada/state.json";

  const { blueprint, intentGraph } = loadBlueprintState(statePath);

  // Scan the codebase
  const snapshot = scanCodebase(options.projectRoot);

  // Diff blueprint against code
  const diff = diffBlueprintAgainstCode(blueprint, intentGraph, snapshot);

  // Compute overall score (weighted average)
  const overallScore =
    diff.entityCoverage * 0.4 +
    diff.invariantCoverage * 0.3 +
    diff.componentCoverage * 0.3;

  const passed =
    overallScore >= 0.7 &&
    diff.findings.filter((f) => f.severity === "critical").length === 0;

  // Generate postcode
  const contentHash = JSON.stringify({
    findings: diff.findings.length,
    entityCoverage: diff.entityCoverage,
    invariantCoverage: diff.invariantCoverage,
    componentCoverage: diff.componentCoverage,
  });
  const postcode = generatePostcode("VER", contentHash);

  return {
    findings: diff.findings,
    contextResults: diff.contextResults,
    entityCoverage: diff.entityCoverage,
    invariantCoverage: diff.invariantCoverage,
    componentCoverage: diff.componentCoverage,
    overallScore,
    passed,
    blueprintPostcode: blueprint.postcode.raw,
    postcode,
    invariantTiers: diff.invariantTiers,
  };
}
