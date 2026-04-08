import type { Blueprint, DelegationContract } from "@swm/compiler";

// ─── Contract file ────────────────────────────────────────────────────────────

export interface ContractFile {
  readonly context: string;
  readonly path: string; // relative path in project
  readonly contract: DelegationContract;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives allowed path globs from a bounded context name.
 * Conventions: src/{context}/**, packages/{context}/**, apps/{context}/**
 */
function deriveAllowedPaths(boundedContext: string): string[] {
  const slug = boundedContext.toLowerCase().replace(/\s+/g, "-");
  return [
    `src/${slug}/**`,
    `packages/${slug}/**`,
    `apps/${slug}/**`,
    `lib/${slug}/**`,
  ];
}

/**
 * Derives the max recursion depth from the component's dependency count.
 * Leaf components (no dependencies) get depth 0 — they cannot spawn further.
 * Components with 1-2 deps get depth 1. Deeper graphs get depth 2.
 * Global max is 3 — prevents unbounded delegation trees.
 */
function deriveMaxDepth(dependencies: readonly string[]): number {
  if (dependencies.length === 0) return 0;
  if (dependencies.length <= 2) return 1;
  return 2;
}

/**
 * Derives stop conditions from the workflow postconditions assigned to this context.
 * These are the conditions under which the agent MUST stop and report up rather
 * than continuing autonomously.
 */
function deriveStopConditions(
  blueprint: Blueprint,
  boundedContext: string,
): string[] {
  const stops: string[] = [
    "Any invariant violation detected",
    "Two consecutive tool failures on the same operation",
    "Implementation diverges from compiled blueprint intent",
  ];

  // Add postconditions from workflows that touch this context
  const contextTerms = [boundedContext.toLowerCase()];
  for (const wf of blueprint.processModel.workflows) {
    for (const step of wf.steps) {
      const haystack = [step.hoareTriple.action, step.hoareTriple.postcondition]
        .join(" ")
        .toLowerCase();
      if (
        contextTerms.some((t) => haystack.includes(t)) &&
        step.failureModes.length > 0
      ) {
        stops.push(
          `Failure mode reached: ${step.failureModes.map((f) => f.description).join("; ")}`,
        );
        break;
      }
    }
  }

  return stops;
}

/**
 * Derives required evidence — what the agent must have produced before returning.
 * Sourced from workflow postconditions assigned to this context.
 */
function deriveRequiredEvidence(
  blueprint: Blueprint,
  boundedContext: string,
): string[] {
  const evidence: string[] = [];
  const contextTerms = [boundedContext.toLowerCase()];

  for (const wf of blueprint.processModel.workflows) {
    for (const step of wf.steps) {
      const haystack = [
        step.name,
        step.hoareTriple.action,
        step.hoareTriple.postcondition,
      ]
        .join(" ")
        .toLowerCase();
      if (contextTerms.some((t) => haystack.includes(t))) {
        evidence.push(step.hoareTriple.postcondition);
      }
    }
  }

  if (evidence.length === 0) {
    evidence.push("Component builds without TypeScript errors");
    evidence.push("No pre-existing tests broken");
  }

  return evidence;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function blueprintToContracts(blueprint: Blueprint): ContractFile[] {
  const contracts: ContractFile[] = [];
  const now = Date.now();
  const blueprintPostcode =
    typeof blueprint.postcode === "string"
      ? blueprint.postcode
      : JSON.stringify(blueprint.postcode);

  // One contract per bounded context (deduplicated — multiple components can share a context)
  const seenContexts = new Set<string>();

  for (const comp of blueprint.architecture.components) {
    const ctx = comp.boundedContext;
    if (seenContexts.has(ctx)) continue;
    seenContexts.add(ctx);

    const slug = ctx.toLowerCase().replace(/\s+/g, "-");
    const allowedPaths = deriveAllowedPaths(ctx);

    // Forbidden = all other contexts' paths
    const forbiddenPaths = blueprint.architecture.components
      .filter((c) => c.boundedContext !== ctx)
      .flatMap((c) => deriveAllowedPaths(c.boundedContext).map((p) => `!${p}`));

    const contract: DelegationContract = {
      context: ctx,
      componentName: comp.name,
      scope: {
        boundedContext: ctx,
        allowedPathGlobs: allowedPaths,
        forbiddenPathGlobs: forbiddenPaths,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      },
      stopConditions: deriveStopConditions(blueprint, ctx),
      requiredEvidence: deriveRequiredEvidence(blueprint, ctx),
      reportingCadence: "on-completion",
      maxRecursionDepth: deriveMaxDepth(comp.dependencies),
      inheritedPermissions: [
        "Bash(pnpm *)",
        "Bash(tsc *)",
        "Bash(node *)",
        "Bash(git status)",
        "Bash(git diff *)",
        "mcp__ada__*",
      ],
      compiledAt: now,
      blueprintPostcode,
    };

    contracts.push({
      context: ctx,
      path: `.claude/contracts/${slug}.json`,
      contract,
    });
  }

  return contracts;
}
