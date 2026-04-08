import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { SONNET } from "../models.js";
import type {
  EntityMap,
  IntentGraph,
  DomainContext,
  CompilerStageCode,
} from "../types.js";
import { entityMapSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";

export interface EntityInput {
  readonly intentGraph: IntentGraph;
  readonly domainContext: DomainContext;
}

export class EntityAgent extends Agent<EntityInput, EntityMap> {
  readonly name = "Entity";
  readonly stageCode: CompilerStageCode = "ENT";
  readonly model = SONNET;
  readonly lens = "STRUCTURAL — nouns, invariants";

  protected getSchema(): ZodSchema {
    return entityMapSchema;
  }

  protected getDefaultOutput(_input: EntityInput): EntityMap {
    return {
      entities: [],
      boundedContexts: [],
      challenges: [],
      postcode: generatePostcode("ENT", "default"),
    };
  }

  protected buildPrompt(input: EntityInput): string {
    const goalList = input.intentGraph.goals
      .map((g) => `${g.id}: ${g.description}`)
      .join("\n  ");
    const domain = input.domainContext.domain;
    const vocab = Object.entries(input.domainContext.ubiquitousLanguage)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n  ");

    const rawIntent = input.intentGraph.rawIntent ?? "";

    return `You are the Entity agent. Your lens: STRUCTURAL — nouns, invariants.
You are BLIND to behavior/workflows — only model what EXISTS, not what HAPPENS.

DOMAIN: ${domain}

GOALS:
  ${goalList}

VOCABULARY:
  ${vocab || "none defined"}

RAW INTENT (full original text — use this to find explicit entity definitions, domain models, and named concepts the user described):
${rawIntent}

First, think out loud about what entities must exist in this system.
If the raw intent contains explicit entity definitions, extract them directly — do not ignore them.

For each entity you find, explain WHY it must exist:
  ◈ "X must exist because [goal] requires [capability]"
Show the invariants as predicates and explain what they protect:
  ∴ "x.field !== null — because without this, [consequence]"
Group entities into bounded contexts and name the root entity for each.
Use ✗ for things that seem like entities but are actually behavior (hand those to Process).
Use ✓ for entities you're certain must exist.

Rules:
- Category must be one of: substance, quality, relation, event, state
- Every entity MUST have at least 1 property and at least 1 invariant
- Invariants must be PREDICATES: "entity.field !== null" not "field must exist"
- Group entities into bounded contexts with one root entity per context

The reasoning above is for the user to read. The JSON below is for the system.
Output ONLY a JSON object inside a \`\`\`json fence. Do NOT write prose after the JSON.

\`\`\`json
{
  "entities": [
    {
      "name": "CLIProgram",
      "category": "substance",
      "properties": [
        {"name": "name", "type": "string", "required": true},
        {"name": "entryPoint", "type": "string", "required": true}
      ],
      "invariants": [
        {"predicate": "cliProgram.name !== null && cliProgram.name.length > 0", "description": "program must have a name"},
        {"predicate": "cliProgram.entryPoint !== null", "description": "must have an entry point file"}
      ]
    }
  ],
  "boundedContexts": [
    {
      "name": "cli",
      "rootEntity": "CLIProgram",
      "entities": ["CLIProgram"],
      "invariants": []
    }
  ],
  "challenges": []
}
\`\`\`

Replace the example above with REAL entities derived from the goals and domain. Do not copy the example — produce entities specific to this project.`;
  }
}
