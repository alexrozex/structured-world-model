import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getBlueprint } from "./tools/blueprint.js";
import { getInvariants } from "./tools/invariants.js";
import { verifyCode } from "./tools/verify.js";
import { getWorkflow } from "./tools/workflow.js";
import { logDrift } from "./tools/drift.js";
import { proposeAgent } from "./tools/propose-agent.js";
import { queryConstraints } from "./tools/query-constraints.js";
import { checkDrift } from "./tools/check-drift.js";
import { getWorldModel } from "./tools/get-world-model.js";
import { proposeAmendment } from "./tools/propose-amendment.js";
import {
  getRuntimeState,
  createCheckpoint,
  rollbackTo,
  recordFact,
} from "./tools/runtime-state.js";
import { getMacroPlan } from "./tools/macro-plan.js";
import { extractSkills, proposeSkill } from "./tools/skill-extraction.js";
import {
  runVerificationStack,
  type VerifierLayer,
} from "./tools/verify-stack.js";
import {
  getContract,
  enterDelegation,
  exitDelegation,
} from "./tools/get-contract.js";
import { reportImplementationDecision, reportGap } from "./tools/feedback.js";
import { reportExecutionFailure, resolveRepair } from "./tools/local-repair.js";
import { advanceExecution } from "./tools/advance.js";
import { completeSubGoal } from "./tools/execution-orchestrator.js";
import { setTaskStatus as setTaskStatusSubGoal } from "./tools/task-status.js";
import { compileIntent } from "./tools/compile.js";
import { researchTopic } from "./tools/research.js";

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "ada", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Ada semantic compiler — intent authority for this codebase. " +
        "Before modifying any entity or data model: call ada.query_constraints with the entity name. " +
        "Before any significant implementation decision: call ada.check_drift with a description of the change. " +
        "When your implementation deviates from the blueprint: call ada.log_drift. " +
        "The blueprint in ada.get_blueprint is the authority — code must trace to it. " +
        "Start a new project by calling ada.compile(intent) — this runs the full 9-stage compilation and sets up governance. " +
        "After compile completes, call ada.get_macro_plan() to get your execution order. " +
        "Call ada.research(query) when you need current information about a library, API, or pattern.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ada.get_blueprint",
        description: "Returns the full active Blueprint",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "ada.get_invariants",
        description: "Returns predicate-form invariants for the named entity",
        inputSchema: {
          type: "object" as const,
          properties: { entityName: { type: "string" as const } },
          required: ["entityName"],
        },
      },
      {
        name: "ada.verify",
        description:
          "Checks code against entity invariants from active Blueprint",
        inputSchema: {
          type: "object" as const,
          properties: {
            code: { type: "string" as const },
            entityName: { type: "string" as const },
          },
          required: ["code", "entityName"],
        },
      },
      {
        name: "ada.get_workflow",
        description:
          "Returns steps, preconditions, postconditions for the named workflow",
        inputSchema: {
          type: "object" as const,
          properties: { workflowName: { type: "string" as const } },
          required: ["workflowName"],
        },
      },
      {
        name: "ada.log_drift",
        description: "Logs semantic drift to provenance store",
        inputSchema: {
          type: "object" as const,
          properties: {
            location: { type: "string" as const },
            original: { type: "string" as const },
            actual: { type: "string" as const },
            severity: {
              type: "string" as const,
              enum: ["critical", "major", "minor"],
            },
          },
          required: ["location", "original", "actual", "severity"],
        },
      },
      {
        name: "ada.propose_agent",
        description: "Writes a new agent .md to .claude/agents/",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
            description: { type: "string" as const },
            tools: {
              type: "array" as const,
              items: { type: "string" as const },
            },
            trigger: { type: "string" as const },
          },
          required: ["name", "description", "tools", "trigger"],
        },
      },
      {
        name: "ada.query_constraints",
        description:
          "Returns invariants and workflow steps from the compiled blueprint matching the given scope. Use before modifying any entity or workflow to understand the constraints Ada compiled from original intent.",
        inputSchema: {
          type: "object" as const,
          properties: {
            scope: {
              type: "string" as const,
              description:
                "Domain scope to filter by, e.g. 'payment', 'user', 'auth'",
            },
          },
          required: ["scope"],
        },
      },
      {
        name: "ada.check_drift",
        description:
          "Checks whether a described action or change aligns with Ada's compiled intent graph. Returns aligned=true/false with violations and matched goals. Use before implementing any significant change.",
        inputSchema: {
          type: "object" as const,
          properties: {
            description: {
              type: "string" as const,
              description:
                "Description of the action or change you are about to make",
            },
          },
          required: ["description"],
        },
      },
      {
        name: "ada.propose_amendment",
        description:
          "Proposes a change to the compiled blueprint when implementation reveals it is incomplete or incorrect. Ada processes the queue via 'ada review-amendments'. Use when you discover during implementation that a goal is missing, an entity needs a new invariant, or a workflow step is wrong.",
        inputSchema: {
          type: "object" as const,
          properties: {
            stage: {
              type: "string" as const,
              description:
                "Pipeline stage to amend: INT, PER, ENT, PRO, or SYN",
            },
            field: {
              type: "string" as const,
              description:
                "The specific field being amended (e.g. 'goals', 'entities', 'workflows')",
            },
            proposed: {
              type: "string" as const,
              description: "Proposed addition or replacement",
            },
            rationale: {
              type: "string" as const,
              description:
                "Why implementation revealed this amendment is needed",
            },
            original: {
              type: "string" as const,
              description: "Current blueprint value (optional)",
            },
          },
          required: ["stage", "field", "proposed", "rationale"],
        },
      },
      {
        name: "ada.extract_skills",
        description:
          "Analyzes the session log to find repeated implementation patterns across sessions. Proposes skill candidates to .ada/skill-candidates.json for human review via 'ada review-skills'. Patterns must appear in 2+ distinct sessions to qualify.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "ada.propose_skill",
        description:
          "Queues a skill proposal for human review. The skill will NOT be written to .claude/skills/ until a human approves it via 'ada review-skills'. Governance rule: skills improve workflows — they do not modify compiled intent, entity invariants, or delegation policies.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, description: "Skill name (slug)" },
            description: {
              type: "string" as const,
              description: "One-line description",
            },
            trigger: {
              type: "string" as const,
              description: "When to invoke this skill",
            },
            skillBody: {
              type: "string" as const,
              description: "Full SKILL.md content including frontmatter",
            },
            rationale: {
              type: "string" as const,
              description: "Why this skill is needed",
            },
          },
          required: [
            "name",
            "description",
            "trigger",
            "skillBody",
            "rationale",
          ],
        },
      },
      {
        name: "ada.verify",
        description:
          "Runs the Ada verification stack against the current world-state. " +
          "Without a layer, runs all five: structural (dependency graph), execution (tool coverage), " +
          "policy (contract scope), outcome (postcondition evidence), provenance (file traceability). " +
          "Returns layered report with scores and findings. Use after completing any significant implementation step.",
        inputSchema: {
          type: "object" as const,
          properties: {
            layer: {
              type: "string" as const,
              enum: [
                "structural",
                "execution",
                "policy",
                "outcome",
                "provenance",
              ],
              description:
                "Optional: run only this layer. Omit to run all five.",
            },
            scope: {
              type: "string" as const,
              description:
                "Optional: bounded context scope filter for policy layer",
            },
          },
        },
      },
      {
        name: "ada.get_contract",
        description:
          "Returns the delegation contract for a bounded context. Includes scope (allowed paths and tools), stop conditions, required evidence, max recursion depth, and current delegation depth. Call at the start of any agent session to understand your bounds.",
        inputSchema: {
          type: "object" as const,
          properties: {
            context: {
              type: "string" as const,
              description: "Bounded context name (e.g. 'payments', 'auth')",
            },
          },
          required: ["context"],
        },
      },
      {
        name: "ada.enter_delegation",
        description:
          "Registers this agent as entering a delegation for the given context. Validates that max recursion depth is not exceeded. Call when a macro planner or orchestrator is about to spawn a child agent.",
        inputSchema: {
          type: "object" as const,
          properties: {
            context: {
              type: "string" as const,
              description: "Bounded context being delegated into",
            },
            agentId: {
              type: "string" as const,
              description:
                "Unique identifier for this agent instance (e.g. 'macro-planner-1')",
            },
          },
          required: ["context", "agentId"],
        },
      },
      {
        name: "ada.exit_delegation",
        description:
          "Removes this agent from the delegation stack. Call when a delegated agent has completed its task and is returning control to its parent.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agentId: {
              type: "string" as const,
              description:
                "Agent ID that was registered via ada.enter_delegation",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "ada.get_macro_plan",
        description:
          "Returns the ordered execution plan for the compiled blueprint. Uses dependency analysis to sequence components and world-state to mark already-complete tasks. Call at the start of any multi-component implementation session.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "ada.advance_execution",
        description:
          "Get your task brief, bounded context contract, and execution instructions. Call this first at the start of every session. Reads subGoals from the active Blueprint, finds the first unblocked subGoal assigned to this agentId (or the first incomplete one), and returns a structured task brief with mission, entities, workflows, invariants, and governance instructions.",
        inputSchema: {
          type: "object" as const,
          properties: {
            agentId: {
              type: "string" as const,
              description:
                "Unique identifier for this agent/session (e.g. the session UUID or agent name)",
            },
            projectDir: {
              type: "string" as const,
              description:
                "Absolute path to the project directory. Defaults to cwd.",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "ada.set_task_status",
        description:
          "Report task completion or status. Call when your bounded context is complete. Writes to .ada/execution-state.json and reports which dependent subGoals are now unblocked. Call when starting a task (in_progress) and when finishing (complete).",
        inputSchema: {
          type: "object" as const,
          properties: {
            component: {
              type: "string" as const,
              description:
                "SubGoal or component name to update (matches subGoal.name from the blueprint)",
            },
            status: {
              type: "string" as const,
              enum: ["in_progress", "complete", "blocked"],
              description: "New status for this component",
            },
            evidence: {
              type: "array" as const,
              items: { type: "string" as const },
              description:
                "File paths or descriptions that constitute evidence of completion",
            },
            projectDir: {
              type: "string" as const,
              description:
                "Absolute path to the project directory. Defaults to cwd.",
            },
          },
          required: ["component", "status"],
        },
      },
      {
        name: "ada.complete_subgoal",
        description:
          "Marks the current bounded context as complete and signals the Ada orchestrator to unlock dependent subGoals. Call this at the end of every orchestrated session after all components in your bounded context are implemented and verified.",
        inputSchema: {
          type: "object" as const,
          properties: {
            subGoalName: {
              type: "string" as const,
              description:
                "The subGoal name from your execution brief (matches subGoal.name in blueprint)",
            },
            evidence: {
              type: "array" as const,
              items: { type: "string" as const },
              description:
                "File paths or postcondition strings proving the bounded context is complete",
            },
          },
          required: ["subGoalName", "evidence"],
        },
      },
      {
        name: "ada.report_execution_failure",
        description:
          "Reports a failure during component execution and receives a repair directive: retry (with attempts remaining) or escalate (max retries reached — surface to human). Call when a component implementation attempt fails. If the directive is escalate, call ada.report_gap and do not retry.",
        inputSchema: {
          type: "object" as const,
          properties: {
            componentName: {
              type: "string" as const,
              description: "The blueprint component that failed",
            },
            failureDescription: {
              type: "string" as const,
              description:
                "What went wrong — be specific enough to inform the next attempt",
            },
            maxRetries: {
              type: "number" as const,
              description:
                "Maximum retry budget for this component (default: 3)",
            },
          },
          required: ["componentName", "failureDescription"],
        },
      },
      {
        name: "ada.resolve_repair",
        description:
          "Marks a component's repair cycle as resolved after a successful retry. Clears the failure count so future failures start fresh. Call after a retry attempt succeeds.",
        inputSchema: {
          type: "object" as const,
          properties: {
            componentName: {
              type: "string" as const,
              description:
                "The blueprint component that was successfully repaired",
            },
          },
          required: ["componentName"],
        },
      },
      {
        name: "ada.record_fact",
        description:
          "Records a fact about the world state with an explicit confidence score (0–1). Use to track observations from tool outputs (source=tool_output) or logical inferences (source=inferred). High-confidence facts lower the overall uncertainty score; low-confidence facts raise it. The aggregate uncertainty is reflected in ada.get_runtime_state.",
        inputSchema: {
          type: "object" as const,
          properties: {
            fact: {
              type: "string" as const,
              description:
                "A declarative statement about the current state of the world",
            },
            confidence: {
              type: "number" as const,
              description:
                "Confidence in this fact, 0–1 (0=unknown, 0.5=uncertain, 0.9=observed, 1.0=certain)",
            },
            source: {
              type: "string" as const,
              enum: ["tool_output", "inferred"],
              description:
                "Whether this fact was directly observed via a tool or inferred from other facts",
            },
            evidencePath: {
              type: "string" as const,
              description:
                "Optional file path that provides evidence for this fact",
            },
          },
          required: ["fact", "confidence", "source"],
        },
      },
      {
        name: "ada.get_runtime_state",
        description:
          "Returns the current world-state snapshot: sessions, tool calls, component execution status, environment facts, and checkpoints. Use when you need to understand what has actually been done vs what was planned.",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "ada.checkpoint",
        description:
          "Creates a named checkpoint of the current world state. Uses git stash for hard rollback capability. Call before any significant change that might need to be undone.",
        inputSchema: {
          type: "object" as const,
          properties: {
            description: {
              type: "string" as const,
              description: "Human-readable description of this checkpoint",
            },
          },
          required: ["description"],
        },
      },
      {
        name: "ada.rollback_to",
        description:
          "Rolls back the filesystem to a named checkpoint using git stash pop. Removes the checkpoint and all later checkpoints from the list.",
        inputSchema: {
          type: "object" as const,
          properties: {
            checkpointId: {
              type: "string" as const,
              description: "Checkpoint ID to roll back to (e.g. cp-1234567890)",
            },
          },
          required: ["checkpointId"],
        },
      },
      {
        name: "ada.get_world_model",
        description:
          "Returns the compiled world model. Without a stage, returns the full manifest (runId, intent, decision, stage index). With a stage code (CTX/INT/PER/ENT/PRO/SYN/VER/GOV), returns that stage's artifact.",
        inputSchema: {
          type: "object" as const,
          properties: {
            stage: {
              type: "string" as const,
              description:
                "Optional stage code: CTX, INT, PER, ENT, PRO, SYN, VER, or GOV",
            },
          },
        },
      },
      {
        name: "ada.report_implementation_decision",
        description:
          "Report when Claude Code makes an implementation decision that deviates from the blueprint. Stored in .ada/feedback/ and injected into the next 'ada compile --amend' run.",
        inputSchema: {
          type: "object" as const,
          properties: {
            componentName: { type: "string" as const },
            decision: { type: "string" as const },
            rationale: { type: "string" as const },
          },
          required: ["componentName", "decision", "rationale"],
        },
      },
      {
        name: "ada.report_gap",
        description:
          "Report when the blueprint is missing something needed for implementation. Stored in .ada/feedback/ and injected into the next 'ada compile --amend' run.",
        inputSchema: {
          type: "object" as const,
          properties: {
            description: { type: "string" as const },
          },
          required: ["description"],
        },
      },
      {
        name: "ada.compile",
        description:
          "Compiles human intent through Ada's 9-stage pipeline (CTX→INT→PER→ENT→PRO→SYN→VER→GOV→BLD). " +
          "Call this FIRST when given a new intent with no existing blueprint. " +
          "Writes CLAUDE.md, agent files, delegation contracts, and world model to the project. " +
          "After this returns, call ada.get_macro_plan() to begin execution.",
        inputSchema: {
          type: "object" as const,
          properties: {
            intent: {
              type: "string" as const,
              description:
                "The full intent to compile — describe what to build",
            },
            projectDir: {
              type: "string" as const,
              description:
                "Absolute path to project directory. Defaults to cwd.",
            },
            amend: {
              type: "boolean" as const,
              description:
                "If true, extends existing blueprint rather than replacing it",
            },
            noWebResearch: {
              type: "boolean" as const,
              description:
                "If true, skips web discovery phase (faster, uses only training data)",
            },
          },
          required: ["intent"],
        },
      },
      {
        name: "ada.research",
        description:
          "Runs targeted web search for current best practices, API details, security patterns, or library versions. " +
          "Call when you are uncertain about a current pattern or API mid-execution. " +
          "Returns direct answer with concrete examples.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string" as const,
              description: "What to research — be specific",
            },
            focus: {
              type: "string" as const,
              description:
                "Optional: specific aspect to focus on (e.g. 'security implications', 'current version')",
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    switch (request.params.name) {
      case "ada.get_blueprint": {
        const r = getBlueprint();
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_invariants": {
        const r = getInvariants(args["entityName"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.verify": {
        const r = verifyCode(
          args["code"] as string,
          args["entityName"] as string,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_workflow": {
        const r = getWorkflow(args["workflowName"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.log_drift": {
        const r = logDrift(
          args["location"] as string,
          args["original"] as string,
          args["actual"] as string,
          args["severity"] as "critical" | "major" | "minor",
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.propose_agent": {
        const r = proposeAgent(
          args["name"] as string,
          args["description"] as string,
          args["tools"] as string[],
          args["trigger"] as string,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.query_constraints": {
        const r = queryConstraints(args["scope"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.check_drift": {
        const r = checkDrift(args["description"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.propose_amendment": {
        const r = proposeAmendment(
          args["stage"] as string,
          args["field"] as string,
          args["proposed"] as string,
          args["rationale"] as string,
          args["original"] as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.extract_skills": {
        const r = extractSkills();
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.propose_skill": {
        const r = proposeSkill(
          args["name"] as string,
          args["description"] as string,
          args["trigger"] as string,
          args["skillBody"] as string,
          args["rationale"] as string,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.verify": {
        const r = runVerificationStack(
          args["layer"] as VerifierLayer | undefined,
          args["scope"] as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_contract": {
        const r = getContract(args["context"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.enter_delegation": {
        const r = enterDelegation(
          args["context"] as string,
          args["agentId"] as string,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.exit_delegation": {
        const r = exitDelegation(args["agentId"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_macro_plan": {
        const r = getMacroPlan();
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.advance_execution": {
        const r = advanceExecution(
          args["agentId"] as string,
          args["projectDir"] as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.set_task_status": {
        const r = setTaskStatusSubGoal(
          args["component"] as string,
          args["status"] as "in_progress" | "complete" | "blocked",
          (args["evidence"] as string[]) ?? [],
          args["projectDir"] as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.complete_subgoal": {
        const r = completeSubGoal(
          args["subGoalName"] as string,
          (args["evidence"] as string[]) ?? [],
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.report_execution_failure": {
        const r = reportExecutionFailure(
          args["componentName"] as string,
          args["failureDescription"] as string,
          args["maxRetries"] !== undefined ? (args["maxRetries"] as number) : 3,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.resolve_repair": {
        const r = resolveRepair(args["componentName"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.record_fact": {
        const r = recordFact(
          args["fact"] as string,
          args["confidence"] as number,
          args["source"] as "tool_output" | "inferred",
          args["evidencePath"] as string | undefined,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_runtime_state": {
        const r = getRuntimeState();
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.checkpoint": {
        const r = createCheckpoint(args["description"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.rollback_to": {
        const r = rollbackTo(args["checkpointId"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.get_world_model": {
        const r = getWorldModel(args["stage"] as string | undefined);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.report_implementation_decision": {
        const r = reportImplementationDecision(
          args["componentName"] as string,
          args["decision"] as string,
          args["rationale"] as string,
        );
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.report_gap": {
        const r = reportGap(args["description"] as string);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.compile": {
        const { intent, projectDir, amend, noWebResearch } = args as {
          intent: string;
          projectDir?: string;
          amend?: boolean;
          noWebResearch?: boolean;
        };
        const r = compileIntent(intent, projectDir ?? process.cwd(), {
          ...(amend !== undefined && { amend }),
          ...(noWebResearch !== undefined && { noWebResearch }),
        });
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      case "ada.research": {
        const { query, focus } = args as { query: string; focus?: string };
        const r = await researchTopic(query, focus);
        return {
          content: [{ type: "text" as const, text: r.content }],
          isError: r.isError,
        };
      }
      default:
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool: ${request.params.name}`,
            },
          ],
          isError: true,
        };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
