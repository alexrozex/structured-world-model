import type { ZodSchema } from "zod";
import { Agent } from "./base.js";
import { SONNET } from "../models.js";
import type { IntentGraph, CompilerStageCode } from "../types.js";
import { intentGraphSchema } from "../schemas.js";
import { generatePostcode } from "@swm/provenance";

export class IntentAgent extends Agent<string, IntentGraph> {
  readonly name = "Intent";
  readonly stageCode: CompilerStageCode = "INT";
  readonly model = SONNET;
  readonly lens = "goals / constraints / unknowns";

  protected getSchema(): ZodSchema {
    return intentGraphSchema;
  }

  protected getDefaultOutput(input: string): IntentGraph {
    return {
      goals: [],
      constraints: [],
      unknowns: [],
      challenges: [],
      rawIntent: input,
      postcode: generatePostcode("INT", input),
    };
  }

  protected buildPrompt(input: string): string {
    return `You are the Intent agent. Your lens: goals / constraints / unknowns.

INTENT: "${input}"

First, think out loud. Read the intent word by word.
For each fragment, say what it tells you — be specific, reference their actual words.
Surface what wasn't said. What did they assume? What did they omit?

Mark key insights with ◈
Mark things you derived that weren't stated with ∴
Mark risks or gaps with ✗
Mark things you're confident about with ✓

End with: what's still unclear? What would you ask if you could?

Then produce goals (stated, derived, implied, unstated), constraints, unknowns, and challenges.
Be proportional to the intent's complexity. A simple intent ("hello world CLI") needs 2-4 goals. A complex intent needs more.
Do NOT over-extract — if the intent is simple, keep the analysis simple. Do NOT invent goals the user didn't imply.

The reasoning above is for the user to read. The JSON below is for the system.
Return the structured result in a \`\`\`json fence:
\`\`\`json
{
  "goals": [
    {"id": "G1", "description": "what the user wants", "type": "stated"},
    {"id": "G2", "description": "what must be true for G1", "type": "derived"}
  ],
  "constraints": [
    {"id": "C1", "description": "explicit limitation", "source": "explicit"}
  ],
  "unknowns": [
    {"id": "U1", "description": "unresolved question", "impact": "blocking"}
  ],
  "challenges": [
    {"id": "CH1", "description": "what could go wrong", "severity": "major", "resolved": false}
  ]
}
\`\`\`
Produce REAL analysis of the intent above, not the example values.`;
  }
}
