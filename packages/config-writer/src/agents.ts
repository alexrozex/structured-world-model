import type { Blueprint, DomainContext } from "@swm/compiler";
import { renderFrontmatter, type AgentFile } from "./types.js";

// ─── Orchestration agents ─────────────────────────────────────────────────────

/**
 * Builds the three system-level orchestration agents that implement the
 * macro/micro execution hierarchy. These are generated for every compiled
 * project — they sit above the bounded-context domain agents.
 */
function buildOrchestrationAgents(blueprint: Blueprint): AgentFile[] {
  const contextList = blueprint.architecture.components
    .map((c) => `${c.name} (${c.boundedContext})`)
    .join(", ");

  // ── Macro Planner ──────────────────────────────────────────────────────────
  const macroPlannerBody = [
    "# Macro Planner",
    "",
    "Orchestrates long-horizon execution across all bounded contexts. Reads the compiled blueprint, builds a dependency-ordered task graph, and delegates bounded work units to domain agents. NEVER writes code directly.",
    "",
    "## Role",
    "You are the macro planner. Your job is to see the whole board and sequence work correctly.",
    "- Call `ada.get_macro_plan` at the start of every session to get the current execution state",
    "- Call `ada.get_runtime_state` to understand what has already been built",
    "- Delegate implementation to the domain agent matching each bounded context",
    "- Create checkpoints before each major delegation: `ada.checkpoint`",
    "- Do NOT implement code yourself — your role is sequencing and escalation",
    "",
    "## Execution Protocol",
    "1. Call `ada.get_macro_plan` — identify NEXT task",
    "2. Call `ada.checkpoint` with description of what you're about to delegate",
    "3. Spawn the domain agent for that bounded context using the Agent tool",
    "4. After agent completes, call `ada.check_drift` to verify alignment",
    "5. Call `ada.get_macro_plan` again — advance to next task",
    "6. If agent reports failure: escalate to human. Do NOT retry more than once.",
    "",
    "## Escalation Criteria",
    "Escalate to human (stop and ask) when:",
    "- A domain agent fails twice on the same task",
    "- `ada.check_drift` returns aligned=false with critical violations",
    "- A dependency is missing that the blueprint does not account for",
    "- The macro plan shows all tasks blocked",
    "",
    `## Bounded Contexts in this Project`,
    contextList,
    "",
    "## Prohibited Actions",
    "- Do NOT write, edit, or delete any file",
    "- Do NOT call Bash to run builds or tests — that is the verifier's job",
    "- Do NOT proceed past a critical drift violation without human approval",
    "",
  ].join("\n");

  const macroPlannerFrontmatter = [
    "---",
    "name: macro-planner",
    "description: Use when orchestrating long-horizon execution across multiple bounded contexts. Reads world-state, sequences tasks by dependency, delegates to domain agents. Does not write code.",
    "model: claude-sonnet-4-6",
    "tools: [Agent, mcp__ada__get_macro_plan, mcp__ada__get_runtime_state, mcp__ada__checkpoint, mcp__ada__check_drift, mcp__ada__log_drift]",
    "maxTurns: 50",
    "---",
    "",
  ].join("\n");

  // ── Execution Orchestrator ─────────────────────────────────────────────────
  const orchestratorBody = [
    "# Execution Orchestrator",
    "",
    "Coordinates the full macro/micro execution cycle. Manages checkpoint creation, evidence collection, verifier handoffs, and failure routing. The orchestrator is the session conductor — it owns the state machine of a multi-agent build.",
    "",
    "## Role",
    "You sit between the macro planner and the domain agents. You:",
    "- Receive a bounded task from the macro planner",
    "- Checkpoint state before starting: `ada.checkpoint`",
    "- Spawn the appropriate domain agent with a clear, bounded brief",
    "- Collect evidence of completion (file paths, postconditions met)",
    "- Hand off to the independent verifier for gate evaluation",
    "- Report pass/fail back to macro planner",
    "",
    "## Cycle",
    "```",
    "receive task → checkpoint → spawn domain agent → collect evidence",
    "→ spawn verifier → evaluate gate → report to macro planner",
    "```",
    "",
    "## Failure Routing",
    "- Micro-level failure (agent error, tool failure): attempt local repair once",
    "- Local repair budget: 1 retry with a different approach",
    "- If repair fails: report BLOCKED to macro planner with evidence",
    "- NEVER silently swallow failures or mark a task complete without verifier confirmation",
    "",
    "## Evidence Requirements",
    "After each domain agent run, collect:",
    "- List of files written or modified",
    "- Postconditions from the workflow steps that were satisfied",
    "- Any open questions or deferred items",
    "",
    "## Prohibited Actions",
    "- Do NOT mark a task complete without passing it through the verifier",
    "- Do NOT exceed one local repair attempt",
    "- Do NOT spawn more than one domain agent simultaneously for the same context",
    "",
  ].join("\n");

  const orchestratorFrontmatter = [
    "---",
    "name: execution-orchestrator",
    "description: Use when coordinating a bounded task through the full macro/micro cycle. Manages checkpoints, spawns domain agent, collects evidence, routes to verifier. The session conductor.",
    "model: claude-sonnet-4-6",
    "tools: [Agent, mcp__ada__checkpoint, mcp__ada__rollback_to, mcp__ada__get_runtime_state, mcp__ada__check_drift, mcp__ada__log_drift]",
    "maxTurns: 80",
    "---",
    "",
  ].join("\n");

  // ── Independent Verifier ───────────────────────────────────────────────────
  const verifierBody = [
    "# Independent Verifier",
    "",
    "Verifies micro-executor output against the compiled blueprint. Separated from the executor — you CANNOT have built what you are verifying. Your job is evaluation, not implementation.",
    "",
    "## Role",
    "You receive a completed task and its evidence. You verify:",
    "1. **Structural** — do the files exist and are they internally consistent?",
    "2. **Alignment** — call `ada.check_drift` with what was implemented",
    "3. **Postconditions** — does the implementation satisfy the workflow postconditions from `ada.get_workflow`?",
    "4. **Invariants** — call `ada.get_invariants` for each entity touched; check none are violated",
    "",
    "## Output",
    "You emit one of:",
    "- **PASS** — all checks satisfied, list evidence",
    "- **FAIL** — one or more checks failed, list violations with file:line references",
    "- **PARTIAL** — structural and alignment pass but postconditions are incomplete — list what remains",
    "",
    "## Verification Steps",
    "1. Call `ada.get_workflow` for the workflow steps this task implements",
    "2. Call `ada.get_invariants` for each entity the task touches",
    "3. Read the files that were written (use Read tool)",
    "4. Call `ada.check_drift` with a description of what was actually implemented",
    "5. Evaluate each postcondition — pass/fail with evidence",
    "6. If drift detected: call `ada.log_drift` with the deviation",
    "7. Emit verdict with full evidence list",
    "",
    "## Prohibited Actions",
    "- Do NOT modify any file",
    "- Do NOT run builds (Bash is available for reading only: `cat`, `tsc --noEmit`)",
    "- Do NOT mark PASS if any postcondition is unverified",
    "- Do NOT self-certify — if you implemented it, you are not the verifier",
    "",
  ].join("\n");

  const verifierFrontmatter = [
    "---",
    "name: independent-verifier",
    "description: Use when verifying a completed micro-executor task against compiled blueprint. Checks structural correctness, drift alignment, postconditions, and invariants. NEVER reimplements — only evaluates.",
    "model: claude-sonnet-4-6",
    "tools: [Read, Grep, Bash, mcp__ada__check_drift, mcp__ada__get_workflow, mcp__ada__get_invariants, mcp__ada__log_drift, mcp__ada__get_blueprint]",
    "maxTurns: 20",
    "---",
    "",
  ].join("\n");

  const compiledAt = Date.now();
  const bpPostcode = blueprint.postcode.raw;

  return [
    {
      name: "macro-planner",
      description:
        "Use when orchestrating long-horizon execution across multiple bounded contexts.",
      model: "claude-sonnet-4-6",
      tools: ["Agent", "mcp__ada__*"],
      status: "",
      body:
        renderFrontmatter({
          postcode: `ML.AGT.macro-planner/v1`,
          type: "agent",
          name: "macro-planner",
          boundedContext: "orchestration",
          parentPostcode: bpPostcode,
          edges: {},
          compiledAt,
        }) +
        macroPlannerFrontmatter +
        macroPlannerBody,
      path: ".claude/agents/macro-planner.md",
    },
    {
      name: "execution-orchestrator",
      description:
        "Use when coordinating a bounded task through the full macro/micro cycle.",
      model: "claude-sonnet-4-6",
      tools: ["Agent", "mcp__ada__*"],
      status: "",
      body:
        renderFrontmatter({
          postcode: `ML.AGT.execution-orchestrator/v1`,
          type: "agent",
          name: "execution-orchestrator",
          boundedContext: "orchestration",
          parentPostcode: bpPostcode,
          edges: {},
          compiledAt,
        }) +
        orchestratorFrontmatter +
        orchestratorBody,
      path: ".claude/agents/execution-orchestrator.md",
    },
    {
      name: "independent-verifier",
      description:
        "Use when verifying a completed micro-executor task against compiled blueprint.",
      model: "claude-sonnet-4-6",
      tools: ["Read", "Grep", "Bash", "mcp__ada__*"],
      status: "",
      body:
        renderFrontmatter({
          postcode: `ML.AGT.independent-verifier/v1`,
          type: "agent",
          name: "independent-verifier",
          boundedContext: "orchestration",
          parentPostcode: bpPostcode,
          edges: {},
          compiledAt,
        }) +
        verifierFrontmatter +
        verifierBody,
      path: ".claude/agents/independent-verifier.md",
    },
  ];
}

export function componentsToAgents(
  blueprint: Blueprint,
  _domainContext?: DomainContext,
): AgentFile[] {
  const agents: AgentFile[] = [...buildOrchestrationAgents(blueprint)];

  for (const comp of blueprint.architecture.components) {
    const name = `${comp.boundedContext}-agent`;
    const fileName = `${name}.md`;

    const description = `Use when ${comp.boundedContext} tasks arise. Owns ${comp.name}. Does not modify files outside ${comp.boundedContext}.`;

    // Get entity names for this bounded context (for MCP directive hints)
    const bc = blueprint.dataModel.boundedContexts.find(
      (b) => b.name === comp.boundedContext,
    );
    const entityNames = bc?.entities ?? [];

    const bodyLines: string[] = [];

    bodyLines.push(`# ${comp.name} Agent`);
    bodyLines.push("");
    bodyLines.push(comp.responsibility);
    bodyLines.push("");

    bodyLines.push("## Bounded Context");
    bodyLines.push(`**Context:** ${comp.boundedContext}`);
    if (entityNames.length > 0) {
      bodyLines.push(`**Entities:** ${entityNames.join(", ")}`);
    }
    if (comp.interfaces.length > 0) {
      bodyLines.push(`**Interfaces:** ${comp.interfaces.join(", ")}`);
    }
    if (comp.dependencies.length > 0) {
      bodyLines.push(`**Dependencies:** ${comp.dependencies.join(", ")}`);
    }
    bodyLines.push("");

    // Out of scope — agents are isolated from CLAUDE.md, repeat safety constraint
    const globalOutOfScope = blueprint.scope?.outOfScope ?? [];
    if (globalOutOfScope.length > 0) {
      bodyLines.push("## Out of Scope");
      for (const exc of globalOutOfScope) {
        bodyLines.push(`- ${exc}`);
      }
      bodyLines.push("");
    }

    // MCP authority — pull all spec content on demand
    bodyLines.push("## Spec Authority (MCP)");
    bodyLines.push(
      "Pull spec content from the MCP server. Do not rely on memory for invariants, workflows, or constraints.",
    );
    bodyLines.push("");
    bodyLines.push("**Session start:**");
    bodyLines.push(
      `- \`ada.get_contract("${comp.boundedContext}")\` — read your delegation contract and scope`,
    );
    bodyLines.push("");
    bodyLines.push("**Before modifying any entity:**");
    for (const entityName of entityNames.slice(0, 3)) {
      bodyLines.push(
        `- \`ada.query_constraints("${entityName}")\` — invariants for ${entityName}`,
      );
    }
    if (entityNames.length > 3) {
      bodyLines.push(
        `- \`ada.query_constraints("<entityName>")\` — for any other entity in this context`,
      );
    }
    if (entityNames.length === 0) {
      bodyLines.push(
        `- \`ada.query_constraints("<entityName>")\` — invariants for any entity you touch`,
      );
    }
    bodyLines.push("");
    bodyLines.push("**During implementation:**");
    bodyLines.push(
      "- `ada.get_workflow(workflowName)` — step-by-step workflow with Hoare triples",
    );
    bodyLines.push(
      "- `ada.check_drift(description)` — verify planned action against original intent",
    );
    bodyLines.push(
      "- `ada.report_execution_failure(component, description)` — request retry guidance",
    );
    bodyLines.push("");
    bodyLines.push("**When complete:**");
    bodyLines.push(
      `- \`ada.set_task_status("${comp.name}", "complete", [<evidence paths>])\``,
    );
    bodyLines.push(
      "- `ada.exit_delegation(agentId)` — release delegation and signal macro planner",
    );
    bodyLines.push("");

    bodyLines.push("## Prohibited Actions");
    bodyLines.push(`- Do NOT modify files outside ${comp.boundedContext}`);
    bodyLines.push("- Do NOT circumvent hook enforcement");
    bodyLines.push(
      "- Do NOT proceed without querying constraints for any entity you modify",
    );
    bodyLines.push("");

    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `model: claude-sonnet-4-6`,
      `tools: [Bash, Read, Write, Edit, Glob, Grep, mcp__ada__get_contract, mcp__ada__query_constraints, mcp__ada__get_workflow, mcp__ada__check_drift, mcp__ada__log_drift, mcp__ada__set_task_status, mcp__ada__exit_delegation, mcp__ada__report_execution_failure]`,
      `maxTurns: 30`,
      "---",
      "",
    ].join("\n");

    const adaFrontmatter = renderFrontmatter({
      postcode: `ML.AGT.${comp.name.toLowerCase().replace(/\s/g, "-")}/v1`,
      type: "agent",
      name: comp.name,
      boundedContext: comp.boundedContext,
      parentPostcode: blueprint.postcode.raw,
      edges: {
        ...(comp.interfaces.length > 0 ? { implements: comp.interfaces } : {}),
        ...(comp.dependencies.length > 0
          ? { dependsOn: comp.dependencies }
          : {}),
      },
      compiledAt: Date.now(),
    });

    agents.push({
      name,
      description,
      model: "claude-sonnet-4-6",
      tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "mcp__ada__*"],
      status: "",
      body: adaFrontmatter + frontmatter + bodyLines.join("\n"),
      path: `.claude/agents/${fileName}`,
    });
  }

  return agents;
}
