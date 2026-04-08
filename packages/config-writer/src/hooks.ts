import type { EntityMap } from "@swm/compiler";
import type { HookScript } from "./types.js";

// ─── Predicate classification ─────────────────────────────────────────────────

type EnforcementStrategy = "grep-block" | "grep-require" | "comment-only";

interface ClassifiedPredicate {
  readonly strategy: EnforcementStrategy;
  readonly pattern: string | null;
  readonly negate: boolean;
}

const BLOCK_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/must\s+not\s+(?:use|import|call|reference|contain)\s+(.+)/i, "$1"],
  [/no\s+(.+)\s+(?:allowed|permitted)/i, "$1"],
  [/never\s+(?:use|import|call)\s+(.+)/i, "$1"],
  [/(?:exclude|block|ban|forbid)\s+(.+)/i, "$1"],
  [/must\s+not\s+contain\s+(.+)/i, "$1"],
];

const REQUIRE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/must\s+(?:use|import|contain|include|have)\s+(.+)/i, "$1"],
  [/(?:require|enforce)\s+(.+)/i, "$1"],
  [/always\s+(?:use|include)\s+(.+)/i, "$1"],
];

function classifyPredicate(predicate: string): ClassifiedPredicate {
  for (const [regex, replacement] of BLOCK_PATTERNS) {
    const match = predicate.match(regex);
    if (match) {
      const raw = predicate.replace(regex, replacement).trim();
      const pattern = raw.replace(/[^a-zA-Z0-9_\-./ ]/g, "").trim();
      if (pattern.length > 0) {
        return { strategy: "grep-block", pattern, negate: false };
      }
    }
  }

  for (const [regex, replacement] of REQUIRE_PATTERNS) {
    const match = predicate.match(regex);
    if (match) {
      const raw = predicate.replace(regex, replacement).trim();
      const pattern = raw.replace(/[^a-zA-Z0-9_\-./ ]/g, "").trim();
      if (pattern.length > 0) {
        return { strategy: "grep-require", pattern, negate: true };
      }
    }
  }

  return { strategy: "comment-only", pattern: null, negate: false };
}

// ─── Script generation ────────────────────────────────────────────────────────

function generateScript(
  entityName: string,
  predicate: string,
  description: string,
  classified: ClassifiedPredicate,
): string {
  const header = `#!/bin/bash
# Invariant: ${predicate}
# Entity: ${entityName}
# Description: ${description}
INPUT=$(cat)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.command // ""')
`;

  if (classified.strategy === "comment-only") {
    return `${header}# Structural enforcement not possible for this predicate.
# Manual review required: ${predicate}
exit 0
`;
  }

  const escapedPattern = classified.pattern!.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\\\$&",
  );

  if (classified.strategy === "grep-block") {
    return `${header}if echo "$CONTENT" | grep -qiE "${escapedPattern}"; then
  echo "Invariant violated [${entityName}]: ${predicate}" >&2
  exit 2
fi
exit 0
`;
  }

  // grep-require: fail if pattern is NOT found (but only when content is non-empty)
  return `${header}if [ -n "$CONTENT" ]; then
  if ! echo "$CONTENT" | grep -qiE "${escapedPattern}"; then
    echo "Invariant violated [${entityName}]: ${predicate}" >&2
    exit 2
  fi
fi
exit 0
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function invariantsToHooks(entityMap: EntityMap): HookScript[] {
  const hooks: HookScript[] = [];

  for (const entity of entityMap.entities) {
    for (const invariant of entity.invariants) {
      const name = `${entity.name.toLowerCase()}-${invariant.predicate
        .replace(/[^a-zA-Z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40)}`;

      const classified = classifyPredicate(invariant.predicate);

      // Skip comment-only predicates — they generate no-op scripts that
      // would fire on every tool call without enforcing anything.
      if (classified.strategy === "comment-only") continue;

      // Determine which tools this hook should watch
      const matcher =
        classified.strategy === "grep-block" ? "Bash|Write|Edit" : "Write|Edit";

      const script = generateScript(
        entity.name,
        invariant.predicate,
        invariant.description,
        classified,
      );

      hooks.push({
        name,
        type: "pre-tool",
        matcher,
        script,
        path: `hooks/pre-tool/${name}.sh`,
      });
    }
  }

  return hooks;
}
