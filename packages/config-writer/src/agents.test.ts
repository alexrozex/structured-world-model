/**
 * Unit tests for componentsToAgents — stakeholder vocabulary persistence.
 * Verifies that PER stage ubiquitousLanguage and per-stakeholder vocabulary
 * survive into generated agent files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { componentsToAgents } from "./agents.js";
import { generatePostcode } from "@swm/provenance";
import type { Blueprint, DomainContext } from "@swm/compiler";

function makeBlueprint(): Blueprint {
  const pc = generatePostcode("SYN", "test");
  return {
    summary: "A booking system for medical appointments.",
    scope: { inScope: ["booking"], outOfScope: [], assumptions: [] },
    architecture: {
      pattern: "layered",
      rationale: "Standard CRUD",
      components: [
        {
          name: "BookingService",
          boundedContext: "Booking",
          responsibility: "Manages appointment scheduling",
          interfaces: [],
          dependencies: [],
        },
      ],
    },
    dataModel: {
      entities: [],
      boundedContexts: [
        {
          name: "Booking",
          rootEntity: "Appointment",
          entities: [],
          invariants: [],
        },
      ],
      challenges: [],
      postcode: generatePostcode("ENT", "test"),
    },
    processModel: {
      workflows: [],
      stateMachines: [],
      challenges: [],
      postcode: generatePostcode("PRO", "test"),
    },
    nonFunctional: [],
    openQuestions: [],
    resolvedConflicts: [],
    challenges: [],
    postcode: pc,
  };
}

function makeDomainContext(): DomainContext {
  return {
    domain: "healthcare scheduling",
    stakeholders: [
      {
        role: "patient",
        knowledgeBase: ["knows their symptoms"],
        blindSpots: ["billing complexity"],
        vocabulary: {
          appointment: "a scheduled visit with a provider",
          slot: "an available time block",
        },
        fearSet: ["double-booking"],
      },
      {
        role: "clinician",
        knowledgeBase: ["clinical workflows"],
        blindSpots: ["patient tech literacy"],
        vocabulary: {
          encounter: "a documented patient visit",
        },
        fearSet: ["missed appointments"],
      },
    ],
    ubiquitousLanguage: {
      appointment: "a scheduled interaction between patient and provider",
      provider: "a credentialed healthcare professional",
    },
    excludedConcerns: ["billing", "prescriptions"],
    challenges: [],
    postcode: generatePostcode("PER", "test"),
  };
}

test("ubiquitousLanguage terms appear in domain agent body", () => {
  const bp = makeBlueprint();
  const dc = makeDomainContext();
  const agents = componentsToAgents(bp, dc);
  const domainAgent = agents.find((a) => a.name === "Booking-agent");
  assert.ok(domainAgent, "Booking-agent should be generated");
  assert.ok(
    domainAgent.body.includes("## Domain Vocabulary"),
    "should have Domain Vocabulary section",
  );
  assert.ok(
    domainAgent.body.includes("**appointment**"),
    "ubiquitousLanguage term 'appointment' should appear",
  );
  assert.ok(
    domainAgent.body.includes("**provider**"),
    "ubiquitousLanguage term 'provider' should appear",
  );
});

test("stakeholder roles appear in agent body", () => {
  const bp = makeBlueprint();
  const dc = makeDomainContext();
  const agents = componentsToAgents(bp, dc);
  const domainAgent = agents.find((a) => a.name === "Booking-agent");
  assert.ok(domainAgent, "Booking-agent should be generated");
  assert.ok(
    domainAgent.body.includes("## Stakeholders"),
    "should have Stakeholders section",
  );
  assert.ok(
    domainAgent.body.includes("**patient**"),
    "patient stakeholder should appear",
  );
  assert.ok(
    domainAgent.body.includes("**clinician**"),
    "clinician stakeholder should appear",
  );
});

test("per-stakeholder vocabulary is written to agent file", () => {
  const bp = makeBlueprint();
  const dc = makeDomainContext();
  const agents = componentsToAgents(bp, dc);
  const domainAgent = agents.find((a) => a.name === "Booking-agent");
  assert.ok(domainAgent, "Booking-agent should be generated");
  // patient vocabulary
  assert.ok(
    domainAgent.body.includes('"appointment"'),
    "stakeholder vocab term 'appointment' should appear in quoted form",
  );
  assert.ok(
    domainAgent.body.includes('"slot"'),
    "stakeholder vocab term 'slot' should appear",
  );
  // clinician vocabulary
  assert.ok(
    domainAgent.body.includes('"encounter"'),
    "clinician vocab term 'encounter' should appear",
  );
});

test("no domain vocabulary section when domainContext is absent", () => {
  const bp = makeBlueprint();
  const agents = componentsToAgents(bp, undefined);
  const domainAgent = agents.find((a) => a.name === "Booking-agent");
  assert.ok(domainAgent, "Booking-agent should be generated");
  assert.ok(
    !domainAgent.body.includes("## Domain Vocabulary"),
    "should not have Domain Vocabulary section without domainContext",
  );
  assert.ok(
    !domainAgent.body.includes("## Stakeholders"),
    "should not have Stakeholders section without domainContext",
  );
});
