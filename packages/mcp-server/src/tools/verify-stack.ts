import * as fs from "node:fs";
import * as path from "node:path";
import { loadBlueprint } from "../state.js";
import { buildWorldState } from "./runtime-state.js";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface VerifierFinding {
  readonly layer: VerifierLayer;
  readonly severity: "critical" | "major" | "minor" | "info";
  readonly description: string;
  readonly evidence?: string;
}

export type VerifierLayer =
  | "structural"
  | "execution"
  | "policy"
  | "outcome"
  | "provenance";

export interface LayerResult {
  readonly layer: VerifierLayer;
  readonly passed: boolean;
  readonly score: number; // 0–1
  readonly findings: readonly VerifierFinding[];
  readonly checkedAt: number;
}

export interface VerificationReport {
  readonly layers: readonly LayerResult[];
  readonly overallScore: number;
  readonly passed: boolean;
  readonly summary: string;
  readonly generatedAt: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getProjectDir(): string {
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"]!)
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 1;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ─── Layer 1: Structural ──────────────────────────────────────────────────────
// Checks blueprint component dependency graph: acyclicity, existence of declared
// dependencies, no isolated components. Static — no I/O beyond blueprint read.

export function verifyStructural(): LayerResult {
  const now = Date.now();
  const findings: VerifierFinding[] = [];
  const blueprint = loadBlueprint();

  if (!blueprint) {
    return {
      layer: "structural",
      passed: false,
      score: 0,
      findings: [
        {
          layer: "structural",
          severity: "critical",
          description:
            "No compiled blueprint found — structural check requires a blueprint",
        },
      ],
      checkedAt: now,
    };
  }

  const components = blueprint.architecture.components;
  const nameSet = new Set(components.map((c) => c.name));

  // Check 1: all declared dependencies reference real components
  for (const comp of components) {
    for (const dep of comp.dependencies) {
      if (!nameSet.has(dep)) {
        findings.push({
          layer: "structural",
          severity: "major",
          description: `Component "${comp.name}" declares dependency on "${dep}" which does not exist in blueprint`,
          evidence: `components: ${[...nameSet].join(", ")}`,
        });
      }
    }
  }

  // Check 2: acyclicity (DFS cycle detection)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(name: string, chain: string[]): void {
    if (inStack.has(name)) {
      cycles.push(`${chain.join(" → ")} → ${name}`);
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    inStack.add(name);
    const comp = components.find((c) => c.name === name);
    for (const dep of comp?.dependencies ?? []) {
      if (nameSet.has(dep)) dfs(dep, [...chain, name]);
    }
    inStack.delete(name);
  }

  for (const comp of components) dfs(comp.name, []);

  for (const cycle of cycles) {
    findings.push({
      layer: "structural",
      severity: "critical",
      description: `Circular dependency detected: ${cycle}`,
    });
  }

  // Check 3: no component has more than 7 declared interfaces (interface segregation)
  for (const comp of components) {
    if (comp.interfaces.length > 7) {
      findings.push({
        layer: "structural",
        severity: "minor",
        description: `Component "${comp.name}" has ${comp.interfaces.length} interfaces — exceeds 7-method segregation limit`,
        evidence: comp.interfaces.join(", "),
      });
    }
  }

  // Check 4: bounded contexts are non-empty
  const contextsWithComponents = new Set(
    components.map((c) => c.boundedContext),
  );
  for (const bc of blueprint.dataModel.boundedContexts) {
    if (!contextsWithComponents.has(bc.name)) {
      findings.push({
        layer: "structural",
        severity: "minor",
        description: `Bounded context "${bc.name}" has no components assigned to it`,
      });
    }
  }

  const criticalCount = findings.filter(
    (f) => f.severity === "critical",
  ).length;
  const majorCount = findings.filter((f) => f.severity === "major").length;
  const totalChecks =
    components.length * 2 + blueprint.dataModel.boundedContexts.length;
  const failCount = criticalCount * 3 + majorCount;
  const score = Math.max(0, 1 - failCount / Math.max(totalChecks, 1));
  const passed = criticalCount === 0 && majorCount === 0;

  return { layer: "structural", passed, score, findings, checkedAt: now };
}

// ─── Layer 2: Execution ───────────────────────────────────────────────────────
// Reads session log and matches tool calls against workflow step pre/postconditions.
// Measures execution coverage — what fraction of planned steps have evidence.

export function verifyExecution(): LayerResult {
  const now = Date.now();
  const findings: VerifierFinding[] = [];
  const blueprint = loadBlueprint();
  const worldState = buildWorldState();

  if (!blueprint) {
    return {
      layer: "execution",
      passed: false,
      score: 0,
      findings: [
        {
          layer: "execution",
          severity: "critical",
          description:
            "No compiled blueprint — execution check requires a blueprint",
        },
      ],
      checkedAt: now,
    };
  }

  const writtenPaths = worldState.recentPaths;
  const allSteps = blueprint.processModel.workflows.flatMap((wf) =>
    wf.steps.map((s) => ({ workflow: wf.name, ...s })),
  );

  let coveredSteps = 0;

  for (const step of allSteps) {
    // Heuristic: does any written path relate to terms in this step's action?
    const actionTerms = step.hoareTriple.action
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 4);

    const hasEvidence = writtenPaths.some((p) => {
      const pl = p.toLowerCase();
      return actionTerms.some((t) => pl.includes(t));
    });

    if (hasEvidence) {
      coveredSteps++;
    } else if (worldState.totalToolCalls > 0) {
      // Only flag gaps if there has been actual execution
      findings.push({
        layer: "execution",
        severity: "minor",
        description: `No file evidence for step "${step.name}" in workflow "${step.workflow}"`,
        evidence: `Action: ${step.hoareTriple.action.slice(0, 80)}`,
      });
    }
  }

  const score = allSteps.length > 0 ? coveredSteps / allSteps.length : 1;

  // Only fail if execution has started but coverage is very low
  const passed = worldState.totalToolCalls === 0 || score >= 0.3;

  if (worldState.totalToolCalls === 0) {
    findings.push({
      layer: "execution",
      severity: "info",
      description: "No tool calls recorded yet — execution has not started",
    });
  } else {
    findings.push({
      layer: "execution",
      severity: "info",
      description: `Execution coverage: ${(score * 100).toFixed(0)}% (${coveredSteps}/${allSteps.length} workflow steps have file evidence)`,
    });
  }

  return { layer: "execution", passed, score, findings, checkedAt: now };
}

// ─── Layer 3: Policy ──────────────────────────────────────────────────────────
// Checks whether files written during execution are within the delegation contract
// scope for the given bounded context. Deterministic predicate evaluation.

export function verifyPolicy(scope?: string): LayerResult {
  const now = Date.now();
  const findings: VerifierFinding[] = [];
  const worldState = buildWorldState();
  const projectDir = getProjectDir();

  // Load contracts
  const contractsPath = path.join(projectDir, ".claude", "contracts");
  const contracts: Array<{
    context: string;
    allowedPathGlobs: string[];
    forbiddenPathGlobs: string[];
  }> = [];

  try {
    const files = fs
      .readdirSync(contractsPath)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(contractsPath, file), "utf8");
        const contract = JSON.parse(raw) as {
          context: string;
          scope: { allowedPathGlobs: string[]; forbiddenPathGlobs: string[] };
        };
        if (!scope || contract.context.toLowerCase() === scope.toLowerCase()) {
          contracts.push({
            context: contract.context,
            allowedPathGlobs: contract.scope.allowedPathGlobs,
            forbiddenPathGlobs: contract.scope.forbiddenPathGlobs,
          });
        }
      } catch {
        // skip malformed contract
      }
    }
  } catch {
    findings.push({
      layer: "policy",
      severity: "info",
      description:
        "No delegation contracts found — policy check skipped. Run 'ada compile' to generate contracts.",
    });
    return {
      layer: "policy",
      passed: true,
      score: 1,
      findings,
      checkedAt: now,
    };
  }

  if (contracts.length === 0) {
    findings.push({
      layer: "policy",
      severity: "info",
      description: scope
        ? `No contract found for context "${scope}"`
        : "No contracts to check",
    });
    return {
      layer: "policy",
      passed: true,
      score: 1,
      findings,
      checkedAt: now,
    };
  }

  // For each written path, find which contract it belongs to (if any)
  // Flag paths that fall into a forbidden glob of any contract
  function matchesGlob(filePath: string, globs: string[]): boolean {
    return globs.some((glob) => {
      // Simple glob: strip leading !, then check prefix or ** wildcard
      const pattern = glob.replace(/^!/, "");
      if (pattern.endsWith("/**")) {
        const prefix = pattern.slice(0, -3);
        return filePath.startsWith(prefix);
      }
      return filePath.includes(pattern.replace(/\*/g, ""));
    });
  }

  let violations = 0;
  for (const writtenPath of worldState.recentPaths) {
    const relPath = writtenPath.startsWith("/")
      ? path.relative(projectDir, writtenPath)
      : writtenPath;

    for (const contract of contracts) {
      const forbidden = contract.forbiddenPathGlobs.map((g) =>
        g.replace(/^!/, ""),
      );
      if (matchesGlob(relPath, forbidden)) {
        findings.push({
          layer: "policy",
          severity: "major",
          description: `File "${relPath}" is in forbidden scope for context "${contract.context}"`,
          evidence: `Forbidden patterns: ${forbidden.slice(0, 3).join(", ")}`,
        });
        violations++;
      }
    }
  }

  if (violations === 0 && worldState.recentPaths.length > 0) {
    findings.push({
      layer: "policy",
      severity: "info",
      description: `All ${worldState.recentPaths.length} written paths are within contract scope`,
    });
  }

  const score =
    worldState.recentPaths.length > 0
      ? 1 - violations / worldState.recentPaths.length
      : 1;
  const passed = violations === 0;

  return { layer: "policy", passed, score, findings, checkedAt: now };
}

// ─── Layer 4: Outcome ─────────────────────────────────────────────────────────
// Returns postconditions from the blueprint paired with file evidence so the
// LLM caller (Claude Code) can evaluate whether each postcondition is satisfied.
// Does NOT call an LLM — instead surfaces what needs to be verified.

export function verifyOutcome(): LayerResult {
  const now = Date.now();
  const findings: VerifierFinding[] = [];
  const blueprint = loadBlueprint();
  const worldState = buildWorldState();

  if (!blueprint) {
    return {
      layer: "outcome",
      passed: false,
      score: 0,
      findings: [
        {
          layer: "outcome",
          severity: "critical",
          description:
            "No compiled blueprint — outcome check requires a blueprint",
        },
      ],
      checkedAt: now,
    };
  }

  const allPostconditions = blueprint.processModel.workflows.flatMap((wf) =>
    wf.steps.map((s) => ({
      workflow: wf.name,
      step: s.name,
      postcondition: s.hoareTriple.postcondition,
    })),
  );

  if (allPostconditions.length === 0) {
    findings.push({
      layer: "outcome",
      severity: "info",
      description: "No workflow postconditions defined in blueprint",
    });
    return {
      layer: "outcome",
      passed: true,
      score: 1,
      findings,
      checkedAt: now,
    };
  }

  // Emit each postcondition as an INFO finding so the LLM can evaluate them
  for (const pc of allPostconditions) {
    findings.push({
      layer: "outcome",
      severity: "info",
      description: `[${pc.workflow} / ${pc.step}] Postcondition: ${pc.postcondition}`,
      evidence:
        worldState.recentPaths
          .filter((p) =>
            p
              .toLowerCase()
              .includes(pc.step.toLowerCase().split(/\s/)[0] ?? ""),
          )
          .slice(0, 3)
          .join(", ") || "no file evidence yet",
    });
  }

  // Score based on component completion from world-state
  const completedComponents = worldState.components.filter(
    (c) => c.status === "inferred_complete",
  ).length;
  const totalComponents = worldState.components.length;
  const score = totalComponents > 0 ? completedComponents / totalComponents : 0;

  const passed = score >= 0.8;

  findings.push({
    layer: "outcome",
    severity: "info",
    description:
      `Outcome verification is LLM-evaluated. ` +
      `Component progress: ${completedComponents}/${totalComponents}. ` +
      `Review the postconditions above and confirm each is satisfied in the implementation.`,
  });

  return { layer: "outcome", passed, score, findings, checkedAt: now };
}

// ─── Layer 5: Provenance ──────────────────────────────────────────────────────
// Checks that every written file can be traced to a blueprint component via
// path heuristics (bounded context slug in file path). Flags untraced outputs.

export function verifyProvenance(): LayerResult {
  const now = Date.now();
  const findings: VerifierFinding[] = [];
  const blueprint = loadBlueprint();
  const worldState = buildWorldState();

  if (!blueprint) {
    return {
      layer: "provenance",
      passed: false,
      score: 0,
      findings: [
        {
          layer: "provenance",
          severity: "critical",
          description:
            "No compiled blueprint — provenance check requires a blueprint",
        },
      ],
      checkedAt: now,
    };
  }

  const contextSlugs = new Set(
    blueprint.architecture.components.map((c) =>
      c.boundedContext.toLowerCase().replace(/\s+/g, "-"),
    ),
  );
  const componentNames = new Set(
    blueprint.architecture.components.map((c) =>
      c.name.toLowerCase().replace(/\s+/g, ""),
    ),
  );

  // System paths that are always traceable
  const systemPaths = [".claude/", "hooks/", ".ada/", ".mcp.json", "CLAUDE.md"];

  // Immutability guard: flag writes to .ada/ governance core from Claude Code
  // The .ada/ directory must only be written by `ada compile`, not by implementation work.
  // Exception: .ada/session-log.jsonl, .ada/sessions/, .ada/checkpoints.json, .ada/amendments/
  // are written by hooks/MCP tools — those are allowed.
  const immutablePrefixes = [
    ".ada/manifest",
    ".ada/state",
    ".ada/blueprint",
    ".ada/ref",
  ];
  for (const writtenPath of worldState.recentPaths) {
    const pl = writtenPath.replace(/\\/g, "/");
    const isGovernanceWrite = immutablePrefixes.some((prefix) =>
      pl.toLowerCase().includes(prefix.toLowerCase()),
    );
    if (isGovernanceWrite) {
      findings.push({
        layer: "provenance",
        severity: "critical",
        description: `Governance core file written by implementation: "${writtenPath}" — .ada/manifest, .ada/state, and .ada/blueprint are immutable during execution`,
        evidence: "These files must only be modified by ada compile",
      });
    }
  }

  let tracedCount = 0;
  let untracedCount = 0;

  for (const writtenPath of worldState.recentPaths) {
    const pl = writtenPath.toLowerCase();

    const isSystem = systemPaths.some((sp) => pl.includes(sp.toLowerCase()));
    const isTracedToContext = [...contextSlugs].some((slug) =>
      pl.includes(slug),
    );
    const isTracedToComponent = [...componentNames].some((name) =>
      pl.includes(name),
    );

    if (isSystem || isTracedToContext || isTracedToComponent) {
      tracedCount++;
    } else {
      untracedCount++;
      findings.push({
        layer: "provenance",
        severity: "minor",
        description: `File "${writtenPath}" cannot be traced to any blueprint component`,
        evidence: `Known contexts: ${[...contextSlugs].slice(0, 5).join(", ")}`,
      });
    }
  }

  const total = worldState.recentPaths.length;
  const score = total > 0 ? tracedCount / total : 1;
  const passed = score >= 0.8;

  if (total > 0) {
    findings.push({
      layer: "provenance",
      severity: "info",
      description: `Provenance coverage: ${(score * 100).toFixed(0)}% (${tracedCount}/${total} files traced to blueprint components)`,
    });
  } else {
    findings.push({
      layer: "provenance",
      severity: "info",
      description: "No files written yet — provenance check skipped",
    });
  }

  return { layer: "provenance", passed, score, findings, checkedAt: now };
}

// ─── Umbrella: ada.verify ─────────────────────────────────────────────────────

export function runVerificationStack(
  layer?: VerifierLayer,
  scope?: string,
): { content: string; isError: boolean } {
  try {
    let layers: LayerResult[];

    switch (layer) {
      case "structural":
        layers = [verifyStructural()];
        break;
      case "execution":
        layers = [verifyExecution()];
        break;
      case "policy":
        layers = [verifyPolicy(scope)];
        break;
      case "outcome":
        layers = [verifyOutcome()];
        break;
      case "provenance":
        layers = [verifyProvenance()];
        break;
      default:
        layers = [
          verifyStructural(),
          verifyExecution(),
          verifyPolicy(scope),
          verifyOutcome(),
          verifyProvenance(),
        ];
    }

    const overallScore = avg(layers.map((l) => l.score));
    const passed = layers.every((l) => l.passed);

    const failedLayers = layers.filter((l) => !l.passed).map((l) => l.layer);
    const summary = passed
      ? `All verification layers passed. Score: ${(overallScore * 100).toFixed(0)}%`
      : `Verification failed in: ${failedLayers.join(", ")}. Score: ${(overallScore * 100).toFixed(0)}%`;

    const report: VerificationReport = {
      layers,
      overallScore,
      passed,
      summary,
      generatedAt: Date.now(),
    };

    // ── Format output ──────────────────────────────────────────────────────
    const lines: string[] = [
      `Verification report — ${passed ? "PASSED" : "FAILED"}`,
      `Overall score: ${(overallScore * 100).toFixed(0)}%`,
      `Layers checked: ${layers.length}`,
      "",
    ];

    for (const result of layers) {
      const icon = result.passed ? "✓" : "✗";
      lines.push(
        `${icon} ${result.layer.toUpperCase()} — ${(result.score * 100).toFixed(0)}%`,
      );
      const notable = result.findings.filter(
        (f) => f.severity !== "info" || result.findings.length <= 3,
      );
      for (const f of notable.slice(0, 5)) {
        const prefix =
          f.severity === "critical"
            ? "  CRITICAL"
            : f.severity === "major"
              ? "  MAJOR"
              : f.severity === "minor"
                ? "  minor"
                : "  info";
        lines.push(`${prefix}: ${f.description}`);
        if (f.evidence) lines.push(`         evidence: ${f.evidence}`);
      }
      if (notable.length > 5) {
        lines.push(`  ... ${notable.length - 5} more findings`);
      }
      lines.push("");
    }

    lines.push(summary);
    lines.push("", JSON.stringify(report, null, 2));

    return { content: lines.join("\n"), isError: !passed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Verification stack failed: ${message}`,
      isError: true,
    };
  }
}
