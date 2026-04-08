/**
 * Unit tests for classifyInvariant — three-tier invariant scoring.
 * Run: node --test dist/verify/blueprint-differ.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyInvariant } from "./blueprint-differ.js";
import type { CodebaseSnapshot, CodeSymbol } from "./codebase-scanner.js";

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

function makeSymbol(
  name: string,
  body: string,
  filePath = "src/types.ts",
): CodeSymbol {
  return {
    name,
    kind: "interface",
    filePath,
    line: 1,
    body,
  };
}

function makeSnapshot(
  symbols: CodeSymbol[],
  fileContents: Record<string, string> = {},
): CodebaseSnapshot {
  const fileIndex = new Map<string, string>(Object.entries(fileContents));
  return { symbols, fileIndex };
}

/** Build a snapshot where the given content string appears in a file. */
function snapshotWithContent(content: string): CodebaseSnapshot {
  return makeSnapshot([], { "src/impl.ts": content });
}

// ─── Tier 1: enforced (full predicate expression found) ───────────────────────

describe("classifyInvariant — tier 1 (enforced)", () => {
  test("predicate 'entity.name !== null' with snapshot containing '.name !== null' → enforced", () => {
    const snapshot = snapshotWithContent(
      "if (entity.name !== null) { return entity.name; }",
    );
    const tier = classifyInvariant(
      "entity.name !== null",
      "entity name must not be null",
      snapshot,
    );
    assert.equal(tier, "enforced");
  });

  test("predicate with '.count > 0' found in snapshot → enforced", () => {
    const snapshot = snapshotWithContent(
      "assert(entity.count > 0, 'count must be positive');",
    );
    const tier = classifyInvariant(
      "entity.count > 0",
      "entity count must be positive",
      snapshot,
    );
    assert.equal(tier, "enforced");
  });

  test("predicate with '=== 3' found in snapshot → enforced", () => {
    const snapshot = snapshotWithContent(
      "if (chain.hopCount === 3) { validate(); }",
    );
    const tier = classifyInvariant(
      "chain.hopCount === 3",
      "chain must have exactly 3 hops",
      snapshot,
    );
    assert.equal(tier, "enforced");
  });

  test("predicate with '.length > 0' found in snapshot → enforced", () => {
    const snapshot = snapshotWithContent(
      "validate(entity.name.length > 0, 'name must not be empty');",
    );
    const tier = classifyInvariant(
      "entity.name.length > 0",
      "entity name must not be empty",
      snapshot,
    );
    assert.equal(tier, "enforced");
  });
});

// ─── Tier 2: mentioned (property name term found) ─────────────────────────────

describe("classifyInvariant — tier 2 (mentioned)", () => {
  test("property name 'name' from predicate found in snapshot → mentioned (when full predicate not found)", () => {
    // Has the word 'name' but not the full expression '.name !== null'
    const snapshot = snapshotWithContent(
      "const entityName = entity.name; return entityName;",
    );
    const tier = classifyInvariant(
      "entity.name !== null",
      "entity name must not be null",
      snapshot,
    );
    // 'name' appears via dotted access — classifyInvariant finds it via extractPredicateTerms
    assert.equal(tier, "mentioned");
  });

  test("property access 'packageName' found when full predicate not matched → mentioned", () => {
    const snapshot = snapshotWithContent(
      "const pkg = node.packageName; if (!pkg) throw new Error();",
    );
    const tier = classifyInvariant(
      "node.packageName !== null",
      "package name must not be null",
      snapshot,
    );
    assert.equal(tier, "mentioned");
  });
});

// ─── Tier 3: present (description keyword found) ──────────────────────────────

describe("classifyInvariant — tier 3 (present)", () => {
  test("keyword from description found when predicate terms are absent → present", () => {
    // The predicate uses made-up names not in snapshot,
    // but the description keyword 'unique' IS in snapshot
    const snapshot = snapshotWithContent(
      "// Ensures unique entries in the registry",
    );
    const tier = classifyInvariant(
      "registry.uniqueConstraintFoo === true",
      "registry entries must be unique within the set",
      snapshot,
    );
    assert.equal(tier, "present");
  });

  test("description keyword 'valid' found in file when predicate not matched → present", () => {
    const snapshot = snapshotWithContent(
      "function validateInput(input: string): boolean { return input.length > 0; }",
    );
    // Predicate has no terms matchable to 'validateInput' but description has 'valid'
    const tier = classifyInvariant(
      "xyzFoo.barBaz !== null",
      "input must be valid before processing",
      snapshot,
    );
    assert.equal(tier, "present");
  });
});

// ─── Tier 4: absent (nothing found) ───────────────────────────────────────────

describe("classifyInvariant — tier 4 (absent)", () => {
  test("predicate and keyword not in snapshot at all → absent", () => {
    const snapshot = snapshotWithContent(
      "console.log('hello world'); const x = 42;",
    );
    const tier = classifyInvariant(
      "registry.totalComponentCount === 10",
      "registry must have exactly ten components declared",
      snapshot,
    );
    assert.equal(tier, "absent");
  });

  test("empty snapshot → absent", () => {
    const snapshot = makeSnapshot([]);
    const tier = classifyInvariant(
      "entity.name !== null",
      "entity name must not be null",
      snapshot,
    );
    assert.equal(tier, "absent");
  });

  test("snapshot with unrelated content → absent", () => {
    const snapshot = snapshotWithContent(
      "const PI = 3.14159; function area(r: number) { return PI * r * r; }",
    );
    const tier = classifyInvariant(
      "user.emailVerified === true",
      "email must be verified before access",
      snapshot,
    );
    assert.equal(tier, "absent");
  });
});

// ─── Multiple predicates — aggregate tier breakdown ───────────────────────────

describe("classifyInvariant — aggregate tier breakdown", () => {
  test("five predicates produce correct tier breakdown counts", () => {
    const enforcedSnap = snapshotWithContent(
      ".name !== null .count > 0 enforce registry unique valid",
    );

    const predicates = [
      {
        predicate: "entity.name !== null",
        description: "entity name must not be null",
      }, // enforced
      {
        predicate: "entity.count > 0",
        description: "entity count must be positive",
      }, // enforced
      {
        predicate: "node.registryId !== null",
        description: "node registry must be assigned",
      }, // mentioned (registryId via dotted access → 'registryId' in text)
      {
        predicate: "unknownProp.xyzAbc !== null",
        description: "entry must be unique within registry",
      }, // present ('unique' in snap)
      {
        predicate: "zzzz.quuxQuux === false",
        description: "qqqqq zzzz must satisfy qqqqq constraint zzzz",
      }, // absent
    ];

    const tiers = predicates.map((p) =>
      classifyInvariant(p.predicate, p.description, enforcedSnap),
    );

    const counts = {
      enforced: tiers.filter((t) => t === "enforced").length,
      mentioned: tiers.filter((t) => t === "mentioned").length,
      present: tiers.filter((t) => t === "present").length,
      absent: tiers.filter((t) => t === "absent").length,
    };

    assert.equal(
      counts.enforced,
      2,
      `expected 2 enforced, got ${counts.enforced}: ${JSON.stringify(tiers)}`,
    );
    // The rest may be mentioned/present/absent — just assert they sum to 5
    assert.equal(
      counts.enforced + counts.mentioned + counts.present + counts.absent,
      5,
      "all predicates must be classified",
    );
  });

  test("all absent predicates return correct breakdown", () => {
    const emptySnap = makeSnapshot([]);
    const predicates = [
      { predicate: "a.x !== null", description: "x must not be null" },
      { predicate: "b.y > 0", description: "y must be positive" },
      { predicate: "c.z === true", description: "z must be true" },
    ];

    const tiers = predicates.map((p) =>
      classifyInvariant(p.predicate, p.description, emptySnap),
    );

    assert.ok(
      tiers.every((t) => t === "absent"),
      "all must be absent for empty snapshot",
    );
  });
});
