/**
 * Unit tests for blueprintToCLAUDEMD — pure function, no I/O.
 * Run: node --test dist/claude-md.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { blueprintToCLAUDEMD } from "./claude-md.js";
import { generatePostcode, type PostcodeAddress } from "@swm/provenance";
import type { Blueprint, NonFunctionalRequirement } from "@swm/compiler";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const PC = (stage: "ENT" | "SYN" | "INT", label: string): PostcodeAddress =>
  generatePostcode(stage, label);

// ─── Minimal fixture factories ────────────────────────────────────────────────

function makeBlueprint(overrides?: Partial<Blueprint>): Blueprint {
  return {
    summary: "A task management app for tracking personal todos.",
    scope: {
      inScope: ["task creation", "task completion"],
      outOfScope: [],
      assumptions: [],
    },
    architecture: {
      pattern: "layered",
      rationale: "Simple CRUD with clear separation of concerns.",
      components: [
        {
          name: "TaskStore",
          responsibility: "Persists and retrieves tasks.",
          interfaces: ["createTask()", "getTasks()"],
          dependencies: [],
          boundedContext: "TaskManagement",
        },
        {
          name: "TaskController",
          responsibility: "Handles HTTP requests for task operations.",
          interfaces: ["POST /tasks", "GET /tasks"],
          dependencies: ["TaskStore"],
          boundedContext: "TaskManagement",
        },
      ],
    },
    dataModel: {
      entities: [],
      boundedContexts: [],
      challenges: [],
      postcode: PC("ENT", "dataModel"),
    },
    processModel: {
      workflows: [],
      stateMachines: [],
      challenges: [],
      postcode: PC("INT", "processModel"),
    },
    nonFunctional: [
      {
        category: "maintainability",
        requirement: "TypeScript strict mode with no implicit any",
        scope: "global",
        verification: "tsc --noEmit passes",
      } satisfies NonFunctionalRequirement,
      {
        category: "security",
        requirement: "Never expose raw passwords",
        predicate: "passwords.never_plaintext",
        scope: "global",
        verification: "audit the auth layer",
      } satisfies NonFunctionalRequirement,
    ],
    openQuestions: [],
    resolvedConflicts: [],
    challenges: [],
    postcode: PC("SYN", "blueprint"),
    ...overrides,
  };
}

// ─── Required sections ────────────────────────────────────────────────────────

test("output contains ## Summary section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## Summary"), "must include ## Summary");
});

test("output contains ## Working Principles section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(
    output.includes("## Working Principles"),
    "must include ## Working Principles",
  );
});

test("output contains ## Architecture section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## Architecture"), "must include ## Architecture");
});

test("output contains ## Components section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## Components"), "must include ## Components");
});

test("output contains ## Done section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## Done"), "must include ## Done");
});

test("output contains ## Ada MCP section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## Ada MCP"), "must include ## Ada MCP");
});

test("output contains ## This Session section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(output.includes("## This Session"), "must include ## This Session");
});

// ─── Summary content ──────────────────────────────────────────────────────────

test("summary text appears in output", () => {
  const bp = makeBlueprint();
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(
    output.includes("A task management app for tracking personal todos."),
    "summary text must appear in output",
  );
});

test("title is derived from summary (first sentence)", () => {
  const bp = makeBlueprint({
    summary:
      "A booking system for appointments. It handles multi-step scheduling.",
  });
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(
    output.includes("# A booking system for appointments"),
    "title must be first sentence of summary",
  );
});

// ─── Components section ───────────────────────────────────────────────────────

test("all component names appear in output", () => {
  const bp = makeBlueprint();
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(output.includes("TaskStore"), "TaskStore must appear");
  assert.ok(output.includes("TaskController"), "TaskController must appear");
});

test("5-component blueprint lists all component names", () => {
  const bp = makeBlueprint({
    architecture: {
      pattern: "modular-monolith",
      rationale: "Standard separation.",
      components: [
        {
          name: "AuthService",
          responsibility: "Handles auth.",
          interfaces: [],
          dependencies: [],
          boundedContext: "Auth",
        },
        {
          name: "UserService",
          responsibility: "Manages users.",
          interfaces: [],
          dependencies: ["AuthService"],
          boundedContext: "Users",
        },
        {
          name: "ProductService",
          responsibility: "Manages products.",
          interfaces: [],
          dependencies: [],
          boundedContext: "Products",
        },
        {
          name: "OrderService",
          responsibility: "Manages orders.",
          interfaces: [],
          dependencies: ["UserService", "ProductService"],
          boundedContext: "Orders",
        },
        {
          name: "NotificationService",
          responsibility: "Sends notifications.",
          interfaces: [],
          dependencies: ["OrderService"],
          boundedContext: "Notifications",
        },
      ],
    },
  });
  const output = blueprintToCLAUDEMD(bp);
  for (const name of [
    "AuthService",
    "UserService",
    "ProductService",
    "OrderService",
    "NotificationService",
  ]) {
    assert.ok(output.includes(name), `${name} must appear in output`);
  }
});

test("architecture pattern and rationale appear in output", () => {
  const bp = makeBlueprint();
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(output.includes("layered"), "architecture pattern must appear");
  assert.ok(
    output.includes("Simple CRUD with clear separation of concerns."),
    "architecture rationale must appear",
  );
});

// ─── Out of Scope — conditional section ──────────────────────────────────────

test("Out of Scope section absent when outOfScope is empty and no domainContext", () => {
  const bp = makeBlueprint({
    scope: { inScope: [], outOfScope: [], assumptions: [] },
  });
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(
    !output.includes("## Out of Scope"),
    "Out of Scope must be absent when outOfScope is empty",
  );
});

test("Out of Scope section present when blueprint.scope.outOfScope is non-empty", () => {
  const bp = makeBlueprint({
    scope: {
      inScope: ["task creation"],
      outOfScope: ["team collaboration", "file attachments"],
      assumptions: [],
    },
  });
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(output.includes("## Out of Scope"), "must include Out of Scope");
  assert.ok(output.includes("team collaboration"), "excluded item must appear");
  assert.ok(output.includes("file attachments"), "excluded item must appear");
});

test("Out of Scope section present when domainContext.excludedConcerns is non-empty (fallback)", () => {
  const bp = makeBlueprint({
    scope: { inScope: [], outOfScope: [], assumptions: [] },
  });
  const domainContext = {
    domain: "productivity",
    stakeholders: [],
    ubiquitousLanguage: {},
    excludedConcerns: ["mobile app", "offline mode"],
    challenges: [],
    postcode: PC("ENT", "dc001"),
  };
  const output = blueprintToCLAUDEMD(bp, undefined, domainContext);
  assert.ok(output.includes("## Out of Scope"), "must include Out of Scope");
  assert.ok(output.includes("mobile app"), "excluded concern must appear");
  assert.ok(output.includes("offline mode"), "excluded concern must appear");
});

test("blueprint.scope.outOfScope takes precedence over domainContext.excludedConcerns", () => {
  const bp = makeBlueprint({
    scope: {
      inScope: [],
      outOfScope: ["from-blueprint"],
      assumptions: [],
    },
  });
  const domainContext = {
    domain: "test",
    stakeholders: [],
    ubiquitousLanguage: {},
    excludedConcerns: ["from-domain-context"],
    challenges: [],
    postcode: PC("ENT", "dc002"),
  };
  const output = blueprintToCLAUDEMD(bp, undefined, domainContext);
  assert.ok(output.includes("from-blueprint"), "blueprint source must win");
  assert.ok(
    !output.includes("from-domain-context"),
    "domainContext fallback must not appear when blueprint has outOfScope",
  );
});

// ─── Non-functional requirements ─────────────────────────────────────────────

test("non-functional requirement text appears in Done section", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(
    output.includes("TypeScript strict mode with no implicit any"),
    "string NFR must appear",
  );
});

test("structured non-functional requirements appear with predicate", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(
    output.includes("passwords.never_plaintext"),
    "structured NFR predicate must appear",
  );
});

// ─── Open questions — conditional ────────────────────────────────────────────

test("Open Questions section absent when openQuestions is empty", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint({ openQuestions: [] }));
  assert.ok(
    !output.includes("## Open Questions"),
    "Open Questions must be absent when empty",
  );
});

test("Open Questions section present when non-empty", () => {
  const bp = makeBlueprint({
    openQuestions: [
      "Should tasks support sub-tasks?",
      "What is the max task limit?",
    ],
  });
  const output = blueprintToCLAUDEMD(bp);
  assert.ok(output.includes("## Open Questions"), "Open Questions must appear");
  assert.ok(
    output.includes("Should tasks support sub-tasks?"),
    "question text must appear",
  );
});

// ─── Warning banner ───────────────────────────────────────────────────────────

test("warning banner appears when warnings array is non-empty", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint(), [
    "Schema validation failed on SYN stage",
  ]);
  assert.ok(
    output.includes("WARNING: Partial compilation"),
    "warning banner must appear",
  );
  assert.ok(
    output.includes("Schema validation failed on SYN stage"),
    "warning text must appear",
  );
});

test("no warning banner when warnings is undefined", () => {
  const output = blueprintToCLAUDEMD(makeBlueprint());
  assert.ok(
    !output.includes("WARNING: Partial compilation"),
    "no warning banner when no warnings",
  );
});

// ─── Line count ───────────────────────────────────────────────────────────────

test("output is under 250 lines for a typical 5-component blueprint", () => {
  const bp = makeBlueprint({
    architecture: {
      pattern: "modular-monolith",
      rationale: "Standard separation.",
      components: [
        {
          name: "AuthService",
          responsibility: "Handles auth.",
          interfaces: [],
          dependencies: [],
          boundedContext: "Auth",
        },
        {
          name: "UserService",
          responsibility: "Manages users.",
          interfaces: [],
          dependencies: ["AuthService"],
          boundedContext: "Users",
        },
        {
          name: "ProductService",
          responsibility: "Manages products.",
          interfaces: [],
          dependencies: [],
          boundedContext: "Products",
        },
        {
          name: "OrderService",
          responsibility: "Manages orders.",
          interfaces: [],
          dependencies: ["UserService"],
          boundedContext: "Orders",
        },
        {
          name: "NotificationService",
          responsibility: "Sends notifications.",
          interfaces: [],
          dependencies: ["OrderService"],
          boundedContext: "Notifications",
        },
      ],
    },
    openQuestions: ["Should notifications be real-time?"],
    scope: {
      inScope: ["order management", "user management"],
      outOfScope: ["mobile app", "analytics dashboard"],
      assumptions: [],
    },
  });
  const output = blueprintToCLAUDEMD(bp);
  const lineCount = output.split("\n").length;
  assert.ok(lineCount < 250, `expected < 250 lines, got ${lineCount}`);
});

// ─── Topological order ────────────────────────────────────────────────────────

test("dependency appears before dependent in Components section", () => {
  const bp = makeBlueprint({
    architecture: {
      pattern: "layered",
      rationale: "Standard.",
      components: [
        {
          name: "Controller",
          responsibility: "Handles requests.",
          interfaces: [],
          dependencies: ["Store"],
          boundedContext: "App",
        },
        {
          name: "Store",
          responsibility: "Persists data.",
          interfaces: [],
          dependencies: [],
          boundedContext: "App",
        },
      ],
    },
  });
  const output = blueprintToCLAUDEMD(bp);
  const storeIdx = output.indexOf("Store");
  const controllerIdx = output.indexOf("Controller");
  assert.ok(
    storeIdx < controllerIdx,
    "Store (dependency) must appear before Controller (dependent)",
  );
});
