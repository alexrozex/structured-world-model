import { IntentAgent } from "./agents/intent.js";
import { PersonaAgent } from "./agents/persona.js";
import { EntityAgent } from "./agents/entity.js";
import { ProcessAgent } from "./agents/process.js";
import { SynthesisAgent } from "./agents/synthesis.js";
import { VerifyAgent } from "./agents/verify.js";
import { GovernorAgent } from "./agents/governor.js";
import { deriveBuildContract } from "./agents/bld.js";
import { buildGate } from "./gate.js";
import type {
  Blueprint,
  CompileResult,
  PipelineState,
  ProvenanceGate,
  StageCompleteEvent,
  CompilerStageCode,
  Challenge,
  StageExecutionRecord,
  ClarificationRequest,
  ClarificationAnswer,
} from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PostcodeAddress } from "@swm/provenance";
import {
  ProvenanceStore,
  ManifoldStore,
  type ManifoldState,
  type SemanticNode,
  type SemanticEdge,
} from "@swm/provenance";
import { RunStore } from "./run-store.js";
import { scheduleSubGoals } from "./subgoal-scheduler.js";
import { analyzeCodebase } from "./context/analyzer.js";
import { discoverContext, groundIntent } from "./web-grounding.js";
import type {
  CodebaseContext,
  PriorBlueprintContext,
} from "./context/types.js";

// ─── Amend merge helpers ───────────────────────────────────────────────────────

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the fraction of content words that overlap between two strings. */
export function wordOverlap(a: string, b: string): number {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "that",
    "this",
    "it",
    "is",
    "are",
    "be",
    "as",
    "so",
    "if",
    "not",
    "no",
    "do",
    "does",
    "can",
    "will",
    "should",
    "must",
    "have",
    "has",
    "had",
    "was",
    "were",
  ]);
  const wordsOf = (s: string) =>
    new Set(
      normaliseText(s)
        .split(" ")
        .filter((w) => w.length > 2 && !stopwords.has(w)),
    );
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

const CONTRADICTION_SIGNALS = [
  "not",
  "no",
  "never",
  "without",
  "avoid",
  "remove",
  "stop",
  "prevent",
  "disallow",
  "reject",
];

function looksLikeContradiction(newGoal: string, priorGoal: string): boolean {
  const nn = normaliseText(newGoal);
  const np = normaliseText(priorGoal);
  const hasNegation = CONTRADICTION_SIGNALS.some((s) => nn.includes(s));
  if (!hasNegation) return false;
  // Contradiction: new goal negates something + shares keywords with prior goal
  return wordOverlap(newGoal, priorGoal) > 0.35;
}

/**
 * Post-process INT output when --amend is active.
 * - Removes goals that are near-duplicates of prior goals (overlap ≥ 0.65)
 * - Merges near-duplicate constraints (overlap ≥ 0.65)
 * - Adds challenges for apparent contradictions with prior goals
 */
export function mergeAmendGoals(
  intentGraph: import("./types.js").IntentGraph,
  prior: PriorBlueprintContext,
): import("./types.js").IntentGraph {
  const DEDUP_THRESHOLD = 0.65;
  const CONTRADICTION_THRESHOLD = 0.4;

  const newGoals = intentGraph.goals.filter((ng) => {
    // Drop if it is a near-duplicate of any prior goal
    return !prior.goals.some(
      (pg) => wordOverlap(ng.description, pg.description) >= DEDUP_THRESHOLD,
    );
  });

  const newConstraints = intentGraph.constraints.filter((nc) => {
    return !prior.constraints.some(
      (pc) => wordOverlap(nc.description, pc.description) >= DEDUP_THRESHOLD,
    );
  });

  // Detect contradictions between new goals and prior goals
  const contradictionChallenges: import("./types.js").Challenge[] = [];
  for (const ng of intentGraph.goals) {
    for (const pg of prior.goals) {
      if (
        looksLikeContradiction(ng.description, pg.description) &&
        wordOverlap(ng.description, pg.description) >= CONTRADICTION_THRESHOLD
      ) {
        contradictionChallenges.push({
          id: `amend-contradiction-${ng.id}-${pg.id}`,
          description: `Possible contradiction between amend goal "${ng.description.slice(0, 80)}" and prior goal "${pg.description.slice(0, 80)}"`,
          severity: "major",
          resolved: false,
        });
      }
    }
  }

  const deduped = newGoals.length < intentGraph.goals.length;
  const dedupedConstraints =
    newConstraints.length < intentGraph.constraints.length;

  return {
    ...intentGraph,
    goals: newGoals,
    constraints: newConstraints,
    challenges: [
      ...intentGraph.challenges,
      ...contradictionChallenges,
      ...(deduped
        ? [
            {
              id: "amend-dedup-goals",
              description: `${intentGraph.goals.length - newGoals.length} goal(s) deduplicated against prior blueprint`,
              severity: "minor" as const,
              resolved: true,
            },
          ]
        : []),
      ...(dedupedConstraints
        ? [
            {
              id: "amend-dedup-constraints",
              description: `${intentGraph.constraints.length - newConstraints.length} constraint(s) deduplicated against prior blueprint`,
              severity: "minor" as const,
              resolved: true,
            },
          ]
        : []),
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────

function gatherProjectContext(cwd: string): string {
  const fragments: string[] = [];

  // CLAUDE.md — primary project spec
  const claudeMd = path.join(cwd, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    const content = fs.readFileSync(claudeMd, "utf8");
    // Take the Summary section and key structural info, cap at 3000 chars
    const summaryMatch = content.match(
      /## Summary\n([\s\S]*?)(?=\n## |\n---|\Z)/,
    );
    if (summaryMatch?.[1]) {
      fragments.push(
        `PROJECT SPEC (from CLAUDE.md):\n${summaryMatch[1].trim().slice(0, 2000)}`,
      );
    } else {
      fragments.push(
        `PROJECT SPEC (from CLAUDE.md):\n${content.slice(0, 2000)}`,
      );
    }
  }

  // package.json — name, description, tech stack
  const pkgJson = path.join(cwd, "package.json");
  if (fs.existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as Record<
        string,
        unknown
      >;
      const info = [
        pkg["name"] ? `name: ${String(pkg["name"])}` : null,
        pkg["description"]
          ? `description: ${String(pkg["description"])}`
          : null,
        pkg["engines"] ? `engines: ${JSON.stringify(pkg["engines"])}` : null,
      ].filter(Boolean);
      if (info.length > 0) {
        fragments.push(`PACKAGE: ${info.join(", ")}`);
      }
    } catch {
      /* skip malformed */
    }
  }

  // tsconfig — confirms TypeScript
  if (
    fs.existsSync(path.join(cwd, "tsconfig.json")) ||
    fs.existsSync(path.join(cwd, "tsconfig.base.json"))
  ) {
    fragments.push("TECH STACK: TypeScript (tsconfig found)");
  }

  // pnpm-workspace.yaml — monorepo structure
  const workspace = path.join(cwd, "pnpm-workspace.yaml");
  if (fs.existsSync(workspace)) {
    fragments.push(
      `MONOREPO: pnpm workspace (${fs.readFileSync(workspace, "utf8").trim()})`,
    );
  }

  // List packages if they exist
  const packagesDir = path.join(cwd, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    try {
      const pkgs = fs.readdirSync(packagesDir).filter((d) => {
        const p = path.join(packagesDir, d, "package.json");
        return fs.existsSync(p);
      });
      if (pkgs.length > 0) {
        fragments.push(`PACKAGES: ${pkgs.join(", ")}`);
      }
    } catch {
      /* skip */
    }
  }

  return fragments.length > 0
    ? "\n\n--- PROJECT CONTEXT (auto-discovered from working directory) ---\n" +
        fragments.join("\n") +
        "\n--- END PROJECT CONTEXT ---"
    : "";
}

export interface CompileOptions {
  readonly apiKey?: string | undefined;
  readonly priorBlueprint?: PriorBlueprintContext | undefined;
  /** When true, Ada is compiling itself — CTX scans Ada's own packages intentionally. */
  readonly selfCompile?: boolean | undefined;
  readonly onStageStart?: (stage: CompilerStageCode) => void;
  readonly onStageToken?: (event: {
    stage: CompilerStageCode;
    token: string;
  }) => void;
  readonly onStageComplete?: (event: StageCompleteEvent) => void;
  readonly onClarificationNeeded?:
    | ((
        requests: readonly ClarificationRequest[],
      ) => Promise<readonly ClarificationAnswer[]>)
    | undefined;
}

export class MotherCompiler {
  private readonly intentAgent = new IntentAgent();
  private readonly personaAgent = new PersonaAgent();
  private readonly entityAgent = new EntityAgent();
  private readonly processAgent = new ProcessAgent();
  private readonly synthesisAgent = new SynthesisAgent();
  private readonly verifyAgent = new VerifyAgent();
  private readonly governorAgent = new GovernorAgent();

  async compile(
    intent: string,
    options: CompileOptions,
  ): Promise<CompileResult> {
    const compileStartedAt = Date.now();
    const {
      onStageStart,
      onStageToken,
      onStageComplete,
      onClarificationNeeded,
      priorBlueprint,
      selfCompile,
    } = options;
    const gates: Record<string, ProvenanceGate> = {};
    const stageRecords: StageExecutionRecord[] = [];
    let cumulativeEntropy = 1.0;
    let previousPostcode: PostcodeAddress | null = null;

    // ─── Provenance store — wired into every stage ───
    // better-sqlite3 is optional (requires native bindings). Fall back to
    // a no-op store when it's not available (Linux without build tools, etc.)
    const cwd = process.cwd();
    const adaDir = path.join(cwd, ".ada");
    fs.mkdirSync(adaDir, { recursive: true });
    let store: Pick<ProvenanceStore, "record">;
    try {
      store = new ProvenanceStore(path.join(adaDir, "provenance.db"));
    } catch {
      store = { record: () => {} };
    }
    // ManifoldStore requires a git repo. Fall back to a no-op when not in one
    // (user running `ada` from home dir, temp dirs, etc.)
    let manifoldStore: Pick<
      ManifoldStore,
      "loadRef" | "loadManifold" | "saveManifold"
    >;
    try {
      manifoldStore = new ManifoldStore(cwd);
    } catch {
      manifoldStore = {
        loadRef: () => null,
        loadManifold: () => {
          throw new Error("no-op manifold store");
        },
        saveManifold: () => "",
      };
    }

    // Initialize or load existing manifold state
    const currentRef = manifoldStore.loadRef();
    let manifoldState: ManifoldState;
    try {
      manifoldState = currentRef
        ? manifoldStore.loadManifold(currentRef)
        : {
            ref: "",
            nodes: {},
            edges: [],
            metrics: { totalEntropy: 1.0, nodeCount: 0, invariantPassRate: 0 },
          };
    } catch {
      manifoldState = {
        ref: "",
        nodes: {},
        edges: [],
        metrics: { totalEntropy: 1.0, nodeCount: 0, invariantPassRate: 0 },
      };
    }

    const runId = `run-${compileStartedAt}`;
    const runStore = new RunStore(adaDir);

    // Initialize manifest as "running"
    runStore.writeManifest(runId, {
      runId,
      intent,
      status: "running",
      startedAt: compileStartedAt,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      stages: [],
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const stageManifestRecords: Array<{
      stage: import("./types.js").CompilerStageCode;
      completedAt: number;
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
      postcode: string;
    }> = [];

    const emitAndGate = (
      stage: CompilerStageCode,
      postcode: PostcodeAddress,
      challenges: readonly Challenge[],
      contentScore: number, // renamed from invariantCount — measures structured content produced
      unresolvedUnknowns: number,
      parseFailure: boolean,
      content: string,
    ): void => {
      const upstreams = previousPostcode ? [previousPostcode.raw] : [];
      store.record(postcode, upstreams, content);

      // ─── Update Manifold State ───
      const newNode: SemanticNode = {
        id: postcode.raw,
        coordinate: postcode.coordinate,
        content: JSON.parse(content),
        provenance: upstreams,
        entropy: cumulativeEntropy, // snapshot before reduction
      };

      const newEdges: SemanticEdge[] = upstreams.map((up) => ({
        from: up,
        to: postcode.raw,
        relation: "derives",
      }));

      manifoldState = {
        ...manifoldState,
        nodes: {
          ...manifoldState.nodes,
          [postcode.raw]: newNode,
        },
        edges: [...manifoldState.edges, ...newEdges],
      };

      if (previousPostcode) {
        const gate = buildGate({
          fromPostcode: previousPostcode,
          toPostcode: postcode,
          challenges: [...challenges],
          invariantCount: contentScore,
          unresolvedUnknowns,
          previousEntropy: cumulativeEntropy,
          parseFailure,
        });
        gates[postcode.raw] = gate;
        cumulativeEntropy = gate.entropyEstimate;
      } else {
        // First stage — no previous postcode, but still compute initial entropy
        const gate = buildGate({
          fromPostcode: postcode, // self-reference for first gate
          toPostcode: postcode,
          challenges: [...challenges],
          invariantCount: contentScore,
          unresolvedUnknowns,
          previousEntropy: cumulativeEntropy,
          parseFailure,
        });
        gates[postcode.raw] = gate;
        cumulativeEntropy = gate.entropyEstimate;
      }

      // Update metrics and persist
      manifoldState = {
        ...manifoldState,
        metrics: {
          totalEntropy: cumulativeEntropy,
          nodeCount: Object.keys(manifoldState.nodes).length,
          invariantPassRate: 1.0, // Placeholder
        },
      };
      manifoldStore.saveManifold(manifoldState);

      onStageComplete?.({
        stage,
        postcode,
        entropyEstimate: cumulativeEntropy,
        challenges,
      });
      previousPostcode = postcode;
    };

    function stageCallbacks(stage: CompilerStageCode) {
      return {
        onToken: onStageToken
          ? (token: string) => onStageToken({ stage, token })
          : undefined,
      };
    }

    // ─── Stage 0: Context (CTX) — static codebase analysis ───
    const codebaseContext: CodebaseContext = analyzeCodebase(cwd, {
      selfCompile: selfCompile ?? false,
    });

    // Set context on agents that benefit from grounding
    this.intentAgent.setCodebaseContext(codebaseContext);
    this.entityAgent.setCodebaseContext(codebaseContext);
    this.synthesisAgent.setCodebaseContext(codebaseContext);

    // Prior blueprint — injected into INT and SYN for --amend runs
    if (priorBlueprint) {
      this.intentAgent.setPriorBlueprint(priorBlueprint);
      this.synthesisAgent.setPriorBlueprint(priorBlueprint);
    }

    // Emit CTX gate
    onStageStart?.("CTX");
    const ctxContentScore =
      codebaseContext.vocabulary.length + codebaseContext.constants.length;
    emitAndGate(
      "CTX",
      codebaseContext.postcode,
      [],
      ctxContentScore,
      0,
      false,
      JSON.stringify(codebaseContext),
    );
    stageRecords.push({
      stageCode: "CTX",
      metadata: {
        modelId: "static-analysis",
        temperature: 0,
        extendedThinking: false,
        maxTokens: 0,
        retryCount: 0,
        callDurationMs: 0,
      },
      postcode: codebaseContext.postcode,
    });
    runStore.writeStageArtifact(runId, "CTX", codebaseContext);
    stageManifestRecords.push({
      stage: "CTX",
      completedAt: Date.now(),
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      postcode: codebaseContext.postcode.raw,
    });

    // ─── Enrich intent with project context + web discovery ───
    const projectContext = gatherProjectContext(cwd);
    const discovery = await discoverContext(intent);
    const enrichedIntent =
      intent + (projectContext ?? "") + (discovery.summary ?? "");

    // ─── Stage 1: Intent (excavate) ───
    onStageStart?.("INT");
    const intentResult = await this.intentAgent.run(
      enrichedIntent,
      stageCallbacks("INT"),
    );
    let intentGraph = {
      ...intentResult.output,
      rawIntent: intent,
      postcode: intentResult.postcode,
    };
    stageRecords.push({
      stageCode: "INT",
      metadata: intentResult.metadata,
      postcode: intentResult.postcode,
    });
    // Persist INT stage artifact
    const intTokens = intentResult.metadata.tokensUsed;
    const intIn = intTokens?.inputTokens ?? 0;
    const intOut = intTokens?.outputTokens ?? 0;
    totalInputTokens += intIn;
    totalOutputTokens += intOut;
    runStore.writeStageArtifact(runId, "INT", intentGraph);
    stageManifestRecords.push({
      stage: "INT",
      completedAt: Date.now(),
      durationMs: intentResult.metadata.callDurationMs,
      inputTokens: intIn,
      outputTokens: intOut,
      postcode: intentResult.postcode.raw,
    });
    // Content score: goals + constraints + unknowns found
    const intContent =
      intentGraph.goals.length + intentGraph.constraints.length;
    emitAndGate(
      "INT",
      intentResult.postcode,
      intentResult.challenges,
      intContent,
      intentGraph.unknowns.length,
      intentResult.parseFailure,
      JSON.stringify(intentGraph),
    );

    // ─── Amend mode: structured goal deduplication ───
    // Remove near-duplicate goals/constraints that the INT agent re-derived
    // from the prior blueprint context it was given. Flag contradictions.
    if (priorBlueprint) {
      intentGraph = mergeAmendGoals(intentGraph, priorBlueprint);
    }

    // ─── Clarification checkpoint ───
    // If project context was available, auto-resolve blocking unknowns
    // that are answerable from the codebase. Only ask the user for
    // genuinely unresolvable questions.
    if (projectContext && intentGraph.unknowns.length > 0) {
      // Downgrade blocking unknowns to scoping when context is present —
      // the context already answers questions about tech stack, scope, etc.
      const downgraded = intentGraph.unknowns.map((u) =>
        u.impact === "blocking" ? { ...u, impact: "scoping" as const } : u,
      );
      intentGraph = { ...intentGraph, unknowns: downgraded };
    }

    if (onClarificationNeeded) {
      const blockers = intentGraph.unknowns.filter(
        (u) => u.impact === "blocking",
      );
      if (blockers.length > 0) {
        const requests: ClarificationRequest[] = blockers.map((u) => ({
          unknownId: u.id,
          question: u.description,
          impact: u.impact,
          suggestedDefault: null,
        }));
        const answers = await onClarificationNeeded(requests);
        if (answers.length > 0) {
          const additionalConstraints = answers.map((a) => ({
            id: `clarification-${a.unknownId}`,
            description: a.answer,
            source: "explicit" as const,
          }));
          const resolvedIds = new Set(answers.map((a) => a.unknownId));
          intentGraph = {
            ...intentGraph,
            constraints: [...intentGraph.constraints, ...additionalConstraints],
            unknowns: intentGraph.unknowns.filter(
              (u) => !resolvedIds.has(u.id),
            ),
          };
        }
      }
    }

    // ─── Stage 2: Persona (situate) ───
    onStageStart?.("PER");
    const personaResult = await this.personaAgent.run(
      intentGraph,
      stageCallbacks("PER"),
    );
    const domainContext = {
      ...personaResult.output,
      postcode: personaResult.postcode,
    };
    stageRecords.push({
      stageCode: "PER",
      metadata: personaResult.metadata,
      postcode: personaResult.postcode,
    });
    // Persist PER stage artifact
    const perTokens = personaResult.metadata.tokensUsed;
    const perIn = perTokens?.inputTokens ?? 0;
    const perOut = perTokens?.outputTokens ?? 0;
    totalInputTokens += perIn;
    totalOutputTokens += perOut;
    runStore.writeStageArtifact(runId, "PER", domainContext);
    stageManifestRecords.push({
      stage: "PER",
      completedAt: Date.now(),
      durationMs: personaResult.metadata.callDurationMs,
      inputTokens: perIn,
      outputTokens: perOut,
      postcode: personaResult.postcode.raw,
    });
    // Content score: vocabulary terms + stakeholders + exclusions
    const perContent =
      Object.keys(domainContext.ubiquitousLanguage).length +
      domainContext.stakeholders.length +
      domainContext.excludedConcerns.length;
    emitAndGate(
      "PER",
      personaResult.postcode,
      personaResult.challenges,
      perContent,
      0,
      personaResult.parseFailure,
      JSON.stringify(domainContext),
    );

    // ─── Stage 3: Entity (crystallize) ───
    onStageStart?.("ENT");
    const entityResult = await this.entityAgent.run(
      { intentGraph, domainContext },
      stageCallbacks("ENT"),
    );
    const entityMap = {
      ...entityResult.output,
      postcode: entityResult.postcode,
    };
    stageRecords.push({
      stageCode: "ENT",
      metadata: entityResult.metadata,
      postcode: entityResult.postcode,
    });
    // Persist ENT stage artifact
    const entTokens = entityResult.metadata.tokensUsed;
    const entIn = entTokens?.inputTokens ?? 0;
    const entOut = entTokens?.outputTokens ?? 0;
    totalInputTokens += entIn;
    totalOutputTokens += entOut;
    runStore.writeStageArtifact(runId, "ENT", entityMap);
    stageManifestRecords.push({
      stage: "ENT",
      completedAt: Date.now(),
      durationMs: entityResult.metadata.callDurationMs,
      inputTokens: entIn,
      outputTokens: entOut,
      postcode: entityResult.postcode.raw,
    });
    const totalInvariants = entityMap.entities.reduce(
      (sum, e) => sum + e.invariants.length,
      0,
    );
    // Content score: entities + invariants + bounded contexts
    const entContent =
      entityMap.entities.length +
      totalInvariants +
      entityMap.boundedContexts.length;
    emitAndGate(
      "ENT",
      entityResult.postcode,
      entityResult.challenges,
      entContent,
      intentGraph.unknowns.filter((u) => u.impact === "blocking").length,
      entityResult.parseFailure,
      JSON.stringify(entityMap),
    );

    // ─── Stage 4: Process (choreograph) ───
    onStageStart?.("PRO");
    const processResult = await this.processAgent.run(
      { intentGraph, domainContext, entityMap },
      stageCallbacks("PRO"),
    );
    const processFlow = {
      ...processResult.output,
      postcode: processResult.postcode,
    };
    stageRecords.push({
      stageCode: "PRO",
      metadata: processResult.metadata,
      postcode: processResult.postcode,
    });
    // Persist PRO stage artifact
    const proTokens = processResult.metadata.tokensUsed;
    const proIn = proTokens?.inputTokens ?? 0;
    const proOut = proTokens?.outputTokens ?? 0;
    totalInputTokens += proIn;
    totalOutputTokens += proOut;
    runStore.writeStageArtifact(runId, "PRO", processFlow);
    stageManifestRecords.push({
      stage: "PRO",
      completedAt: Date.now(),
      durationMs: processResult.metadata.callDurationMs,
      inputTokens: proIn,
      outputTokens: proOut,
      postcode: processResult.postcode.raw,
    });
    // Content score: workflow steps + state machine states + failure modes
    const proSteps = processFlow.workflows.reduce(
      (sum, w) => sum + w.steps.length,
      0,
    );
    const proStates = processFlow.stateMachines.reduce(
      (sum, sm) => sum + sm.states.length,
      0,
    );
    const proEdges = processFlow.workflows.reduce(
      (s, w) => s + w.steps.reduce((ss, st) => ss + st.failureModes.length, 0),
      0,
    );
    emitAndGate(
      "PRO",
      processResult.postcode,
      processResult.challenges,
      proSteps + proStates + proEdges,
      0,
      processResult.parseFailure,
      JSON.stringify(processFlow),
    );

    // ─── Stage 5: Synthesis (compose) ───
    onStageStart?.("SYN");
    const synthesisResult = await this.synthesisAgent.run(
      { intentGraph, domainContext, entityMap, processFlow },
      stageCallbacks("SYN"),
    );
    stageRecords.push({
      stageCode: "SYN",
      metadata: synthesisResult.metadata,
      postcode: synthesisResult.postcode,
    });
    const synthesisOutput = synthesisResult.output;
    // Persist SYN stage artifact
    const synTokens = synthesisResult.metadata.tokensUsed;
    const synIn = synTokens?.inputTokens ?? 0;
    const synOut = synTokens?.outputTokens ?? 0;
    totalInputTokens += synIn;
    totalOutputTokens += synOut;
    runStore.writeStageArtifact(runId, "SYN", synthesisOutput);
    stageManifestRecords.push({
      stage: "SYN",
      completedAt: Date.now(),
      durationMs: synthesisResult.metadata.callDurationMs,
      inputTokens: synIn,
      outputTokens: synOut,
      postcode: synthesisResult.postcode.raw,
    });
    // Write sub-goals to run store
    for (const sg of synthesisOutput.subGoals ?? []) {
      runStore.writeSubGoal(runId, sg.name, sg);
    }
    // Write the execution schedule (topological waves) for parallel orchestration
    const schedule = scheduleSubGoals(synthesisOutput.subGoals ?? []);
    runStore.writeSchedule(runId, schedule);
    const blueprint: Blueprint = {
      summary: synthesisOutput.summary,
      scope: synthesisOutput.scope,
      architecture: synthesisOutput.architecture,
      dataModel: entityMap,
      processModel: processFlow,
      nonFunctional: synthesisOutput.nonFunctional,
      openQuestions: synthesisOutput.openQuestions,
      resolvedConflicts: synthesisOutput.resolvedConflicts,
      challenges: synthesisOutput.challenges,
      subGoals: synthesisOutput.subGoals,
      postcode: synthesisResult.postcode,
    };
    // Content score: components + resolved conflicts + non-functional requirements
    const synContent =
      blueprint.architecture.components.length +
      blueprint.resolvedConflicts.length +
      blueprint.nonFunctional.length;
    emitAndGate(
      "SYN",
      synthesisResult.postcode,
      synthesisResult.challenges,
      synContent,
      blueprint.openQuestions.length,
      synthesisResult.parseFailure,
      JSON.stringify(blueprint),
    );

    // ─── Stage 6: Verify (challenge) ───
    onStageStart?.("VER");
    const verifyResult = await this.verifyAgent.run(
      { blueprint, intentGraph },
      stageCallbacks("VER"),
    );
    const auditReport = {
      ...verifyResult.output,
      postcode: verifyResult.postcode,
    };
    stageRecords.push({
      stageCode: "VER",
      metadata: verifyResult.metadata,
      postcode: verifyResult.postcode,
    });
    // Persist VER stage artifact
    const verTokens = verifyResult.metadata.tokensUsed;
    const verIn = verTokens?.inputTokens ?? 0;
    const verOut = verTokens?.outputTokens ?? 0;
    totalInputTokens += verIn;
    totalOutputTokens += verOut;
    runStore.writeStageArtifact(runId, "VER", auditReport);
    stageManifestRecords.push({
      stage: "VER",
      completedAt: Date.now(),
      durationMs: verifyResult.metadata.callDurationMs,
      inputTokens: verIn,
      outputTokens: verOut,
      postcode: verifyResult.postcode.raw,
    });
    // Content score: checks performed (coverage + coherence are non-zero = 2 checks passed)
    const verContent =
      (auditReport.coverageScore > 0 ? 5 : 0) +
      (auditReport.coherenceScore > 0 ? 5 : 0) +
      auditReport.drifts.length;
    emitAndGate(
      "VER",
      verifyResult.postcode,
      verifyResult.challenges,
      verContent,
      auditReport.gaps.length,
      verifyResult.parseFailure,
      JSON.stringify(auditReport),
    );

    // ─── Stage 7: Governor (govern) ───
    onStageStart?.("GOV");
    const pipelineState: PipelineState = {
      intent: intentGraph,
      persona: domainContext,
      entity: entityMap,
      process: processFlow,
      synthesis: blueprint,
      verify: auditReport,
      governor: null,
      gates,
      cumulativeEntropy,
    };
    const governorResult = await this.governorAgent.run(
      pipelineState,
      stageCallbacks("GOV"),
    );
    const governorDecision = {
      ...governorResult.output,
      postcode: governorResult.postcode,
    };
    stageRecords.push({
      stageCode: "GOV",
      metadata: governorResult.metadata,
      postcode: governorResult.postcode,
    });
    // Persist GOV stage artifact
    const govTokens = governorResult.metadata.tokensUsed;
    const govIn = govTokens?.inputTokens ?? 0;
    const govOut = govTokens?.outputTokens ?? 0;
    totalInputTokens += govIn;
    totalOutputTokens += govOut;
    runStore.writeStageArtifact(runId, "GOV", governorDecision);
    stageManifestRecords.push({
      stage: "GOV",
      completedAt: Date.now(),
      durationMs: governorResult.metadata.callDurationMs,
      inputTokens: govIn,
      outputTokens: govOut,
      postcode: governorResult.postcode.raw,
    });
    // Content score: decision made = content
    const govContent = governorDecision.decision ? 10 : 0;
    emitAndGate(
      "GOV",
      governorResult.postcode,
      governorResult.challenges,
      govContent,
      0,
      governorResult.parseFailure,
      JSON.stringify(governorDecision),
    );

    // Attach audit snapshot to blueprint — persists with the artifact
    const blueprintWithAudit: Blueprint = {
      ...blueprint,
      audit: {
        coverageScore: governorDecision.coverageScore,
        coherenceScore: governorDecision.coherenceScore,
        gatePassRate: governorDecision.gatePassRate,
        iterationCount: 1, // updated at the call site if iterating
        governorDecision: governorDecision.decision,
        confidence: governorDecision.confidence,
        driftCount: auditReport.drifts.length,
        gapCount: auditReport.gaps.length,
        violationCount: governorDecision.violations.length,
      },
    };

    // ─── Stage 8: Build Contract (BLD) — deterministic derivation ───
    // Only runs on ACCEPT. Pure structural derivation — no LLM call.
    let blueprintFinal: Blueprint = blueprintWithAudit;
    if (governorDecision.decision === "ACCEPT") {
      onStageStart?.("BLD");
      const buildContract = deriveBuildContract(blueprintWithAudit);
      blueprintFinal = { ...blueprintWithAudit, build: buildContract };
      stageRecords.push({
        stageCode: "BLD",
        metadata: {
          modelId: "deterministic",
          temperature: 0,
          extendedThinking: false,
          maxTokens: 0,
          retryCount: 0,
          callDurationMs: 0,
        },
        postcode: buildContract.postcode,
      });
      emitAndGate(
        "BLD",
        buildContract.postcode,
        [],
        buildContract.fileTree.filter((n) => n.type === "file").length,
        buildContract.gatePass ? 0 : 1,
        !buildContract.gatePass,
        JSON.stringify(buildContract),
      );
      stageManifestRecords.push({
        stage: "BLD",
        completedAt: Date.now(),
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        postcode: buildContract.postcode.raw,
      });
    }

    const finalState: PipelineState = {
      ...pipelineState,
      synthesis: blueprintFinal,
      governor: governorDecision,
      manifoldState,
    };
    const status =
      governorDecision.decision === "ACCEPT"
        ? ("accepted" as const)
        : governorDecision.decision === "REJECT"
          ? ("rejected" as const)
          : ("iterating" as const);

    const compileCompletedAt = Date.now();
    const compilationRun = {
      runId,
      sourceIntent: intent,
      stages: stageRecords,
      startedAt: compileStartedAt,
      completedAt: compileCompletedAt,
      totalDurationMs: compileCompletedAt - compileStartedAt,
      totalInputTokens,
      totalOutputTokens,
    };

    // Write final blueprint to run store
    runStore.writeStageArtifact(runId, "BLD", blueprintFinal);

    // Write final manifest
    const finalStatus =
      governorDecision.decision === "ACCEPT"
        ? "accepted"
        : governorDecision.decision === "REJECT"
          ? "rejected"
          : "iterating";

    runStore.writeManifest(runId, {
      runId,
      intent,
      status: finalStatus,
      startedAt: compileStartedAt,
      completedAt: compileCompletedAt,
      totalDurationMs: compileCompletedAt - compileStartedAt,
      totalInputTokens,
      totalOutputTokens,
      stages: stageManifestRecords,
    });

    return {
      blueprint: blueprintFinal,
      governorDecision,
      pipelineState: finalState,
      manifoldState,
      status,
      iterationCount: 1,
      compilationRun,
      fallback: null,
    };
  }
}
