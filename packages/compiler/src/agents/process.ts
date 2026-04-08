import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { SONNET } from "../models.js";
import type {
  ProcessFlow,
  IntentGraph,
  DomainContext,
  EntityMap,
  CompilerStageCode,
} from "../types.js";
import { processFlowSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";

export interface ProcessInput {
  readonly intentGraph: IntentGraph;
  readonly domainContext: DomainContext;
  readonly entityMap: EntityMap;
}

export class ProcessAgent extends Agent<ProcessInput, ProcessFlow> {
  readonly name = "Process";
  readonly stageCode: CompilerStageCode = "PRO";
  readonly model = SONNET;
  readonly lens = "BEHAVIORAL — verbs, state, time";

  protected getSchema(): ZodSchema {
    return processFlowSchema;
  }

  protected getDefaultOutput(_input: ProcessInput): ProcessFlow {
    return {
      workflows: [],
      stateMachines: [],
      challenges: [],
      postcode: generatePostcode("PRO", "default"),
    };
  }

  protected buildPrompt(input: ProcessInput): string {
    const goalList = input.intentGraph.goals
      .slice(0, 10)
      .map((g) => `${g.id}: ${g.description}`)
      .join("\n  ");

    // Show ALL entities with their properties — PRO needs to know what fields exist
    const entityDetails = input.entityMap.entities
      .slice(0, 12)
      .map((e) => {
        const props = e.properties.map((p) => p.name).join(", ");
        return `${e.name} (${e.category}): [${props}]`;
      })
      .join("\n  ");

    const contexts = input.entityMap.boundedContexts
      .map((bc) => `${bc.name} → ${bc.entities.join(", ")}`)
      .join("\n  ");

    return `You are the Process agent. Your lens: BEHAVIORAL — verbs, state, time.
You are BLIND to static structure — Entity already locked that. You define BEHAVIOR.

DOMAIN: ${input.domainContext.domain}

GOALS:
  ${goalList}

ENTITIES (with their properties):
  ${entityDetails || "none defined yet"}

BOUNDED CONTEXTS:
  ${contexts || "none defined"}

YOUR TASK:
1. Define at least 2 workflows with steps that have preconditions, actions, and postconditions
2. Define state machines for entities that have lifecycle states
3. Each step needs at least 1 failure mode
4. temporalRelation must be one of: enables, requires, concurrent, compensates, guards
5. failureModes class must be one of: precondition, action, postcondition

First, think out loud about the behavior of this system.

Walk through each workflow step by step:
  ◈ Name the workflow and its trigger
  ∴ Show the Hoare triple for each step — precondition, action, postcondition
  ✗ "If this postcondition fails, [consequence] — recovery: [handler]"
Find the edge cases. What happens when things break? What's the rollback?
For stateful entities, draw the lifecycle: what transitions exist and what guards them?
Use ✓ for steps you're certain about, ✗ for risks, ∴ for things you derived.

The reasoning above is for the user to read. The JSON below is for the system.
Output ONLY a JSON object inside a \`\`\`json fence. Do NOT write text after the JSON.

\`\`\`json
{
  "workflows": [
    {
      "name": "build-project",
      "trigger": "user runs build command",
      "steps": [
        {
          "name": "initialize-project",
          "hoareTriple": {
            "precondition": "projectDir exists and is writable",
            "action": "scaffold project structure",
            "postcondition": "package.json and entry point file exist"
          },
          "failureModes": [
            {"class": "precondition", "description": "directory not writable", "handler": "exit with permission error"}
          ],
          "temporalRelation": "enables"
        }
      ]
    }
  ],
  "stateMachines": [
    {
      "entity": "Project",
      "states": ["uninitialized", "scaffolded", "built", "runnable"],
      "transitions": [
        {"from": "uninitialized", "to": "scaffolded", "trigger": "init", "guard": "directory is empty or has no conflicts"}
      ]
    }
  ],
  "challenges": []
}
\`\`\`

Replace the example above with REAL workflows and state machines for this project. Do not copy the example.`;
  }
}
