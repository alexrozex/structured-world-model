import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { SONNET } from "../models.js";
import type {
  DomainContext,
  IntentGraph,
  CompilerStageCode,
} from "../types.js";
import { domainContextSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";

export class PersonaAgent extends Agent<IntentGraph, DomainContext> {
  readonly name = "Persona";
  readonly stageCode: CompilerStageCode = "PER";
  readonly model = SONNET;
  readonly lens = "domain / vocabulary / exclusions";

  protected getSchema(): ZodSchema {
    return domainContextSchema;
  }

  protected getDefaultOutput(_input: IntentGraph): DomainContext {
    return {
      domain: "unknown",
      stakeholders: [],
      ubiquitousLanguage: {},
      excludedConcerns: [],
      challenges: [],
      postcode: generatePostcode("PER", "default"),
    };
  }

  protected buildPrompt(input: IntentGraph): string {
    const goalList = input.goals
      .map((g) => `${g.id}: ${g.description} (${g.type})`)
      .join("\n  ");
    const constraintList = input.constraints
      .map((c) => `${c.id}: ${c.description}`)
      .join("\n  ");

    return `You are the Persona agent. Your lens: domain / vocabulary / exclusions.

RAW INTENT: "${input.rawIntent}"

GOALS:
  ${goalList}

CONSTRAINTS:
  ${constraintList}

IMPORTANT: Your domain analysis must match the RAW INTENT above, not the environment you're running in. If the intent says "hello world CLI", the domain is CLI development, not AI pipelines or semantic compilers. Ground yourself in what the user actually asked for.

First, think out loud about this domain. Write as if you're situating yourself in the user's world.

◈ Name the domain — not generic, specific to what the user is actually building.
For each stakeholder you identify, explain:
  — what they know and take for granted
  — what they fear going wrong
  — what words they use that mean something specific in this world
What does this world EXCLUDE? Close every door that isn't a feature.
Use ∴ for things you're deriving from context, ✗ for risks or missing information, ✓ for things you're certain about.

The reasoning above is for the user to read. The JSON below is for the system.
Then output ONLY a JSON object inside a \`\`\`json fence.
Do NOT write prose after the JSON.

\`\`\`json
{
  "domain": "specific domain name matching the intent",
  "stakeholders": [
    {
      "role": "primary user type",
      "knowledgeBase": ["what they know"],
      "blindSpots": ["what they assume is handled"],
      "vocabulary": {"their term": "precise meaning"},
      "fearSet": ["what they fear going wrong"]
    }
  ],
  "ubiquitousLanguage": {
    "term": "canonical meaning in this domain"
  },
  "excludedConcerns": [
    "what this system is NOT",
    "what is out of scope",
    "what it does not do"
  ],
  "challenges": []
}
\`\`\`
Produce REAL domain analysis for the intent "${input.rawIntent}". At least 5 excluded concerns.`;
  }
}
