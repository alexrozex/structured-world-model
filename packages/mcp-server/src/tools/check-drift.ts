import { loadManifest, loadStageArtifact } from "../state.js";
import type { DriftCheckResult } from "../types.js";
import type { IntentGraph, GovernorDecision } from "@swm/compiler";

export function checkDrift(description: string): {
  content: string;
  isError: boolean;
} {
  const manifest = loadManifest();
  if (!manifest) {
    return {
      content: "No compiled world model found. Run ada init first.",
      isError: true,
    };
  }

  const intentGraph = loadStageArtifact("INT") as IntentGraph | null;
  const governorDecision = loadStageArtifact("GOV") as GovernorDecision | null;

  if (!intentGraph) {
    return { content: "Intent graph not found in world model.", isError: true };
  }

  const descLower = description.toLowerCase();
  const violations: string[] = [];
  const matchedGoals: string[] = [];

  // Check goals: extract keywords from each goal description, match against the provided description
  for (const goal of intentGraph.goals) {
    const keywords = goal.description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4); // skip short stop words

    const matched = keywords.some((kw) => descLower.includes(kw));
    if (matched) {
      matchedGoals.push(goal.description);
    }
  }

  // Check constraints: if any constraint's description keywords appear, flag as potential violation
  for (const constraint of intentGraph.constraints ?? []) {
    const constraintLower = constraint.description.toLowerCase();
    const constraintKeywords = constraintLower
      .split(/\s+/)
      .filter((w) => w.length > 4);

    // Heuristic: if description contains words that look like they violate the constraint
    // Check for negation patterns: "not", "never", "bypass", "skip", "ignore", "remove"
    const negationWords = [
      "not",
      "never",
      "bypass",
      "skip",
      "ignore",
      "remove",
      "delete",
      "raw",
      "plain",
      "unencrypt",
    ];
    const hasNegation = negationWords.some((neg) => descLower.includes(neg));
    const constraintMatched = constraintKeywords.some((kw) =>
      descLower.includes(kw),
    );

    if (hasNegation && constraintMatched) {
      violations.push(
        `Potential constraint violation: "${constraint.description}" (constraint id: ${constraint.id})`,
      );
    }
  }

  // If no goals matched at all and the description is non-trivial, flag as potential misalignment
  if (matchedGoals.length === 0 && description.length > 20) {
    violations.push(
      `Description does not appear to relate to any compiled intent goals. Original intent: "${manifest.intent.slice(0, 120)}"`,
    );
  }

  const result: DriftCheckResult = {
    aligned: violations.length === 0,
    violations,
    matchedGoals,
    governorDecision: governorDecision?.decision ?? manifest.decision,
    postcodes: [
      manifest.stages["INT"]?.postcode ?? "",
      manifest.stages["GOV"]?.postcode ?? "",
    ].filter(Boolean),
  };

  return { content: JSON.stringify(result, null, 2), isError: false };
}
