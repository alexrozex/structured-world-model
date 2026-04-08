import type { Blueprint, BlueprintComponent, IntentGraph } from "../types.js";
import type { CodebaseSnapshot, CodeSymbol } from "./codebase-scanner.js";
import { findSymbolByName, searchInFiles } from "./codebase-scanner.js";
import type {
  VerificationFinding,
  BoundedContextResult,
  ProvenanceTrace,
  FindingCategory,
  FindingSeverity,
} from "./types.js";

let findingCounter = 0;

function nextId(): string {
  return `VF-${String(++findingCounter).padStart(3, "0")}`;
}

function finding(
  category: FindingCategory,
  severity: FindingSeverity,
  confidence: number,
  title: string,
  description: string,
  filePath: string | null,
  lineRange: { start: number; end: number } | null,
  provenance: ProvenanceTrace,
): VerificationFinding {
  return {
    id: nextId(),
    category,
    severity,
    confidence,
    title,
    description,
    filePath,
    lineRange,
    provenance,
  };
}

function traceEntity(
  entityName: string,
  intentGraph: IntentGraph,
): ProvenanceTrace {
  // Try to find which goal this entity traces to
  const goalMatch = intentGraph.goals.find((g) =>
    g.description.toLowerCase().includes(entityName.toLowerCase()),
  );
  return {
    intentGoalId: goalMatch?.id ?? null,
    intentPhrase: goalMatch?.description ?? null,
    blueprintEntity: entityName,
    blueprintInvariant: null,
    blueprintComponent: null,
    blueprintWorkflow: null,
  };
}

function traceInvariant(
  entityName: string,
  predicate: string,
  intentGraph: IntentGraph,
): ProvenanceTrace {
  const goalMatch = intentGraph.goals.find((g) =>
    g.description.toLowerCase().includes(entityName.toLowerCase()),
  );
  return {
    intentGoalId: goalMatch?.id ?? null,
    intentPhrase: goalMatch?.description ?? null,
    blueprintEntity: entityName,
    blueprintInvariant: predicate,
    blueprintComponent: null,
    blueprintWorkflow: null,
  };
}

function traceComponent(
  componentName: string,
  intentGraph: IntentGraph,
): ProvenanceTrace {
  const goalMatch = intentGraph.goals.find((g) =>
    g.description.toLowerCase().includes(componentName.toLowerCase()),
  );
  return {
    intentGoalId: goalMatch?.id ?? null,
    intentPhrase: goalMatch?.description ?? null,
    blueprintEntity: null,
    blueprintInvariant: null,
    blueprintComponent: componentName,
    blueprintWorkflow: null,
  };
}

function traceWorkflow(
  workflowName: string,
  intentGraph: IntentGraph,
): ProvenanceTrace {
  const goalMatch = intentGraph.goals.find((g) =>
    g.description.toLowerCase().includes(workflowName.toLowerCase()),
  );
  return {
    intentGoalId: goalMatch?.id ?? null,
    intentPhrase: goalMatch?.description ?? null,
    blueprintEntity: null,
    blueprintInvariant: null,
    blueprintComponent: null,
    blueprintWorkflow: workflowName,
  };
}

export interface DiffResult {
  readonly findings: readonly VerificationFinding[];
  readonly contextResults: readonly BoundedContextResult[];
  readonly entityCoverage: number;
  readonly invariantCoverage: number;
  readonly componentCoverage: number;
  readonly invariantTiers: import("./types.js").InvariantTierBreakdown;
}

export function diffBlueprintAgainstCode(
  blueprint: Blueprint,
  intentGraph: IntentGraph,
  snapshot: CodebaseSnapshot,
): DiffResult {
  findingCounter = 0;
  const allFindings: VerificationFinding[] = [];

  // 1. Check entities
  let totalEntities = 0;
  let foundEntities = 0;
  const entities = blueprint.dataModel.entities;

  for (const entity of entities) {
    totalEntities++;
    const symbol = findSymbolByName(snapshot, entity.name);

    if (!symbol) {
      // Search for partial matches (e.g. entity name as substring)
      const refs = searchInFiles(snapshot, `\\b${entity.name}\\b`);
      if (refs.length === 0) {
        allFindings.push(
          finding(
            "missing-entity",
            "critical",
            95,
            `Entity "${entity.name}" not found in codebase`,
            `Blueprint defines entity "${entity.name}" (${entity.category}) with ${entity.properties.length} properties and ${entity.invariants.length} invariants, but no matching type, interface, or class exists in the codebase.`,
            null,
            null,
            traceEntity(entity.name, intentGraph),
          ),
        );
      } else {
        // Referenced but not defined as a type — lower confidence
        foundEntities++;
        allFindings.push(
          finding(
            "semantic-drift",
            "minor",
            60,
            `Entity "${entity.name}" referenced but not formally defined`,
            `"${entity.name}" appears in ${refs.length} file(s) but has no exported type/interface/class definition. Found in: ${refs
              .slice(0, 3)
              .map((r) => `${r.filePath}:${r.line}`)
              .join(", ")}`,
            refs[0]?.filePath ?? null,
            refs[0] ? { start: refs[0].line, end: refs[0].line } : null,
            traceEntity(entity.name, intentGraph),
          ),
        );
      }
    } else {
      foundEntities++;

      // Check property coverage for interfaces/classes
      if (
        (symbol.kind === "interface" || symbol.kind === "class") &&
        entity.properties.length > 0
      ) {
        for (const prop of entity.properties) {
          const propPattern = new RegExp(`\\b${prop.name}\\b.*:`);
          if (!propPattern.test(symbol.body)) {
            allFindings.push(
              finding(
                "semantic-drift",
                "minor",
                70,
                `Property "${prop.name}" missing from "${entity.name}"`,
                `Blueprint specifies ${entity.name}.${prop.name}: ${prop.type}${prop.required ? " (required)" : ""} but this property was not found in the type definition.`,
                symbol.filePath,
                { start: symbol.line, end: symbol.line },
                traceEntity(entity.name, intentGraph),
              ),
            );
          }
        }
      }
    }
  }

  // 2. Check invariants — three-tier scoring
  let totalInvariants = 0;
  let tieredEnforced = 0;
  let tieredMentioned = 0;
  let tieredPresent = 0;
  let tieredAbsent = 0;

  for (const entity of entities) {
    for (const inv of entity.invariants) {
      totalInvariants++;

      const tier = classifyInvariant(inv.predicate, inv.description, snapshot);

      switch (tier) {
        case "enforced":
          tieredEnforced++;
          break;
        case "mentioned":
          tieredMentioned++;
          break;
        case "present":
          tieredPresent++;
          break;
        default:
          tieredAbsent++;
          allFindings.push(
            finding(
              "missing-invariant",
              "major",
              75,
              `Invariant not enforced: ${inv.description}`,
              `Blueprint invariant "${inv.predicate}" for entity "${entity.name}" has no apparent enforcement in code. Expected to find validation, assertion, or guard logic.`,
              null,
              null,
              traceInvariant(entity.name, inv.predicate, intentGraph),
            ),
          );
      }
    }
  }

  const invariantTiers: import("./types.js").InvariantTierBreakdown = {
    enforced: tieredEnforced,
    mentioned: tieredMentioned,
    present: tieredPresent,
    absent: tieredAbsent,
    total: totalInvariants,
  };

  // 3. Check components
  let totalComponents = 0;
  let foundComponents = 0;
  const components = blueprint.architecture.components;

  for (const comp of components) {
    totalComponents++;
    const symbol = findSymbolByName(snapshot, comp.name);

    if (symbol) {
      foundComponents++;
      checkComponentMethods(comp, symbol, allFindings, intentGraph, snapshot);
    } else {
      // Tier 1: exact name reference in code
      const refs = searchInFiles(snapshot, `\\b${comp.name}\\b`);
      if (refs.length > 0) {
        foundComponents++;
        continue;
      }

      // Tier 2: method-body matching — search for the component's declared
      // interface methods across all classes and functions. If enough methods
      // are found, the component is implemented under a different name.
      const methodMatch = resolveComponentByMethods(comp, snapshot);
      if (methodMatch) {
        foundComponents++;
        continue;
      }

      // Tier 3: responsibility-keyword matching — extract key nouns from the
      // component's responsibility and match against symbol names/file paths.
      const keywordMatch = resolveComponentByKeywords(comp, snapshot);
      if (keywordMatch) {
        foundComponents++;
        continue;
      }

      allFindings.push(
        finding(
          "unimplemented-component",
          "critical",
          90,
          `Component "${comp.name}" not implemented`,
          `Blueprint defines component "${comp.name}" in bounded context "${comp.boundedContext}" with responsibility: "${comp.responsibility.slice(0, 120)}..." — no matching class, function, or module found.`,
          null,
          null,
          traceComponent(comp.name, intentGraph),
        ),
      );
    }
  }

  // 4. Check workflows
  const workflows = blueprint.processModel.workflows;
  for (const wf of workflows) {
    const refs = searchInFiles(snapshot, `\\b${camelCase(wf.name)}\\b`);
    if (refs.length === 0) {
      allFindings.push(
        finding(
          "missing-process",
          "major",
          65,
          `Workflow "${wf.name}" not implemented`,
          `Blueprint defines workflow "${wf.name}" with ${wf.steps.length} steps triggered by "${wf.trigger}" — no matching implementation found.`,
          null,
          null,
          traceWorkflow(wf.name, intentGraph),
        ),
      );
    }
  }

  // 5. Check state machines
  const stateMachines = blueprint.processModel.stateMachines;
  for (const sm of stateMachines) {
    const stateRefs = searchInFiles(snapshot, `\\b${sm.entity}\\b`);
    if (stateRefs.length === 0) {
      allFindings.push(
        finding(
          "missing-state-machine",
          "major",
          70,
          `State machine for "${sm.entity}" not found`,
          `Blueprint defines a state machine for "${sm.entity}" with states [${sm.states.join(", ")}] and ${sm.transitions.length} transitions, but no implementation found.`,
          null,
          null,
          traceEntity(sm.entity, intentGraph),
        ),
      );
    }
  }

  // Filter by confidence threshold (80)
  const filtered = allFindings.filter((f) => f.confidence >= 80);

  // Build bounded context results
  const contextResults = buildContextResults(blueprint, filtered);

  const entityCoverage = totalEntities > 0 ? foundEntities / totalEntities : 1;
  // invariantCoverage now counts only tier-1 (enforced) — honest metric
  const invariantCoverage =
    totalInvariants > 0 ? tieredEnforced / totalInvariants : 1;
  const componentCoverage =
    totalComponents > 0 ? foundComponents / totalComponents : 1;

  return {
    findings: filtered,
    contextResults,
    entityCoverage,
    invariantCoverage,
    componentCoverage,
    invariantTiers,
  };
}

function buildContextResults(
  blueprint: Blueprint,
  findings: readonly VerificationFinding[],
): BoundedContextResult[] {
  const contexts = blueprint.dataModel.boundedContexts;
  return contexts.map((bc) => {
    const contextEntities = blueprint.dataModel.entities.filter((e) =>
      bc.entities.includes(e.name),
    );
    const contextFindings = findings.filter(
      (f) =>
        f.provenance.blueprintEntity !== null &&
        bc.entities.includes(f.provenance.blueprintEntity),
    );

    const entitiesExpected = contextEntities.length;
    const missingEntities = contextFindings.filter(
      (f) => f.category === "missing-entity",
    ).length;
    const entitiesFound = entitiesExpected - missingEntities;

    const invariantsExpected = contextEntities.reduce(
      (s, e) => s + e.invariants.length,
      0,
    );
    const missingInvariants = contextFindings.filter(
      (f) => f.category === "missing-invariant",
    ).length;
    const invariantsEnforced = invariantsExpected - missingInvariants;

    return {
      contextName: bc.name,
      findings: contextFindings,
      entitiesExpected,
      entitiesFound,
      invariantsExpected,
      invariantsEnforced,
    };
  });
}

// ─── Three-tier invariant matching ────────────────────────────────────────────
// Tier 1 (enforced):  full comparison expression found  e.g. ".name !== null"
// Tier 2 (mentioned): property name term found           e.g. "name"
// Tier 3 (present):   description keyword found          e.g. "null", "unique"
// Tier 4 (absent):    nothing found at all

function extractFullPredicatePatterns(predicate: string): string[] {
  // Extract patterns like ".propName !== null", ".propName > 0", ".propName === 3"
  const patterns: string[] = [];

  // Match dotted property access with comparison operator
  const compRe =
    /\.\s*(\w+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(\w+|null|true|false|"[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = compRe.exec(predicate)) !== null) {
    // Build a regex-safe pattern for the comparison (without the object prefix)
    const prop = m[1]!;
    const op = m[2]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const val = m[3]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patterns.push(`\\.${prop}\\s*${op}\\s*${val}`);
  }

  return [...new Set(patterns)];
}

function extractDescriptionKeywords(description: string): string[] {
  // Extract meaningful nouns/verbs from the description to use as fallback signal
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "must",
    "should",
    "has",
    "have",
    "not",
    "that",
    "this",
    "for",
    "and",
    "or",
    "if",
    "be",
    "to",
    "of",
    "in",
    "it",
    "at",
    "by",
    "as",
    "on",
  ]);
  return description
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 5); // cap at 5 keywords for performance
}

export type InvariantMatchTier =
  | "enforced"
  | "mentioned"
  | "present"
  | "absent";

export function classifyInvariant(
  predicate: string,
  description: string,
  snapshot: CodebaseSnapshot,
): InvariantMatchTier {
  // Tier 1: full comparison expression
  for (const pattern of extractFullPredicatePatterns(predicate)) {
    if (searchInFiles(snapshot, pattern).length > 0) return "enforced";
  }

  // Tier 2: property name terms (existing behaviour)
  for (const term of extractPredicateTerms(predicate)) {
    if (searchInFiles(snapshot, term).length > 0) return "mentioned";
  }

  // Tier 3: description keyword
  for (const kw of extractDescriptionKeywords(description)) {
    if (searchInFiles(snapshot, kw).length > 0) return "present";
  }

  return "absent";
}

function extractPredicateTerms(predicate: string): string[] {
  // Extract identifiers from predicate expressions like
  // "workspacePackage.name !== null && workspacePackage.name.length > 0"
  const terms: string[] = [];

  // Extract dotted property access patterns
  const props = predicate.match(/\w+\.\w+/g);
  if (props) {
    for (const prop of props) {
      const parts = prop.split(".");
      if (parts.length >= 2) {
        terms.push(parts[parts.length - 1]!);
      }
    }
  }

  // Extract comparison values that might be constants
  const nums = predicate.match(/(?:===?\s*)([\d.]+)/g);
  if (nums) {
    for (const num of nums) {
      const val = num.replace(/===?\s*/, "").trim();
      if (val !== "null" && val !== "true" && val !== "false") {
        terms.push(val);
      }
    }
  }

  return [...new Set(terms)];
}

function camelCase(name: string): string {
  return name
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toLowerCase());
}

function checkComponentMethods(
  comp: BlueprintComponent,
  symbol: CodeSymbol,
  allFindings: VerificationFinding[],
  intentGraph: IntentGraph,
  snapshot: CodebaseSnapshot,
): void {
  for (const iface of comp.interfaces) {
    const methodName = iface.match(/^(\w+)\(/)?.[1];
    if (methodName) {
      const methodRefs = searchInFiles(snapshot, `\\b${methodName}\\b`);
      if (methodRefs.length === 0) {
        allFindings.push(
          finding(
            "unimplemented-component",
            "major",
            70,
            `Method "${methodName}" not found for "${comp.name}"`,
            `Blueprint specifies interface "${iface}" on component "${comp.name}" but no implementation of "${methodName}" was found.`,
            symbol.filePath,
            { start: symbol.line, end: symbol.line },
            traceComponent(comp.name, intentGraph),
          ),
        );
      }
    }
  }
}

function resolveComponentByMethods(
  comp: BlueprintComponent,
  snapshot: CodebaseSnapshot,
): boolean {
  // Extract method names from the component's interfaces
  const methodNames: string[] = [];
  for (const iface of comp.interfaces) {
    const match = iface.match(/^(\w+)\(/);
    if (match) methodNames.push(match[1]!);
  }

  if (methodNames.length === 0) return false;

  // Count how many methods are found anywhere in the codebase
  let hits = 0;
  for (const method of methodNames) {
    const refs = searchInFiles(snapshot, `\\b${method}\\b`);
    if (refs.length > 0) hits++;
  }

  // If at least 1/3 of declared methods exist in the codebase,
  // the component is implemented under a different name.
  // Threshold is lenient because blueprints use semantic method names
  // that may not match implementation method names exactly.
  const threshold = Math.max(1, Math.ceil(methodNames.length / 3));
  return hits >= threshold;
}

function resolveComponentByKeywords(
  comp: BlueprintComponent,
  snapshot: CodebaseSnapshot,
): boolean {
  // Extract significant words from component name and responsibility
  // Handle both camelCase and ACRONYM boundaries
  const nameWords = comp.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.toLowerCase());

  // Search for each keyword as part of a symbol name or file path
  // Use stem matching: truncate words to min 4 chars to catch
  // inflected forms (Verifier -> verif matches VerifyAgent)
  for (const word of nameWords) {
    const stem = word.length > 4 ? word.slice(0, -2) : word;
    const match = snapshot.symbols.find(
      (s) =>
        (s.kind === "class" || s.kind === "function") &&
        (s.name.toLowerCase().includes(stem) ||
          s.filePath.toLowerCase().includes(stem)),
    );
    if (match) return true;
  }

  return false;
}
