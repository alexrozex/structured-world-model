/**
 * Tests for model versioning utilities.
 */

import {
  bumpVersion,
  versionModel,
  compareVersions,
} from "../../src/utils/versioning.js";
import type { WorldModelType } from "../../src/schema/index.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

const baseModel: WorldModelType = {
  id: "wm_test",
  name: "Test",
  description: "Test",
  version: "0.1.0",
  created_at: "2026-01-01",
  entities: [],
  relations: [],
  processes: [],
  constraints: [],
  metadata: {
    source_type: "text",
    source_summary: "test",
    confidence: 0.9,
    extraction_notes: ["initial"],
  },
} as WorldModelType;

function run() {
  console.log("\n\u2500\u2500\u2500 Versioning Tests \u2500\u2500\u2500\n");

  // bumpVersion — patch
  assert(bumpVersion("0.1.0", "patch") === "0.1.1", "patch: 0.1.0 → 0.1.1");
  assert(bumpVersion("0.1.5", "patch") === "0.1.6", "patch: 0.1.5 → 0.1.6");
  assert(bumpVersion("1.2.9", "patch") === "1.2.10", "patch: 1.2.9 → 1.2.10");

  // bumpVersion — minor
  assert(bumpVersion("0.1.0", "minor") === "0.2.0", "minor: 0.1.0 → 0.2.0");
  assert(bumpVersion("1.3.7", "minor") === "1.4.0", "minor: 1.3.7 → 1.4.0");

  // bumpVersion — major
  assert(bumpVersion("0.1.0", "major") === "1.0.0", "major: 0.1.0 → 1.0.0");
  assert(bumpVersion("2.5.3", "major") === "3.0.0", "major: 2.5.3 → 3.0.0");

  // bumpVersion — defaults to patch
  assert(bumpVersion("1.0.0") === "1.0.1", "default bump is patch");

  // bumpVersion — handles malformed versions
  assert(
    bumpVersion("1", "patch") === "1.0.1",
    "handles single-number version",
  );
  assert(bumpVersion("", "patch") === "0.0.1", "handles empty version");

  // versionModel — bumps version
  {
    const v = versionModel(baseModel, "Added new entities");
    assert(v.version === "0.1.1", "versionModel: bumps patch by default");
  }

  // versionModel — adds changelog note
  {
    const v = versionModel(baseModel, "Added reviews");
    const notes = v.metadata?.extraction_notes ?? [];
    assert(
      notes.some((n) => n.includes("[v0.1.1]")),
      "versionModel: changelog has version tag",
    );
    assert(
      notes.some((n) => n.includes("Added reviews")),
      "versionModel: changelog has description",
    );
  }

  // versionModel — preserves existing notes
  {
    const v = versionModel(baseModel, "Change");
    const notes = v.metadata?.extraction_notes ?? [];
    assert(notes.includes("initial"), "versionModel: preserves existing notes");
    assert(notes.length === 2, "versionModel: adds one note");
  }

  // versionModel — doesn't mutate original
  {
    const original = { ...baseModel };
    versionModel(baseModel, "Change");
    assert(
      baseModel.version === "0.1.0",
      "versionModel: doesn't mutate original version",
    );
  }

  // versionModel — minor bump
  {
    const v = versionModel(baseModel, "New feature", "minor");
    assert(v.version === "0.2.0", "versionModel: minor bump works");
  }

  // versionModel — handles model without metadata
  {
    const noMeta = { ...baseModel, metadata: undefined };
    const v = versionModel(noMeta as WorldModelType, "Change");
    assert(v.version === "0.1.1", "versionModel: works without metadata");
    assert(
      v.metadata === undefined,
      "versionModel: metadata stays undefined if absent",
    );
  }

  // compareVersions
  assert(compareVersions("0.1.0", "0.1.0") === 0, "compare: equal");
  assert(compareVersions("0.1.0", "0.1.1") === -1, "compare: patch less");
  assert(compareVersions("0.2.0", "0.1.9") === 1, "compare: minor greater");
  assert(compareVersions("1.0.0", "0.99.99") === 1, "compare: major greater");
  assert(compareVersions("0.1.1", "0.1.0") === 1, "compare: patch greater");
  assert(compareVersions("2.0.0", "1.9.9") === 1, "compare: major wins");

  // Chain multiple bumps
  {
    let m = baseModel;
    m = versionModel(m, "First change");
    m = versionModel(m, "Second change");
    m = versionModel(m, "Third change");
    assert(m.version === "0.1.3", "Chain: three patches → 0.1.3");
    assert(
      (m.metadata?.extraction_notes ?? []).length === 4,
      "Chain: 1 original + 3 changelog entries",
    );
  }

  console.log(
    `\n\u2550\u2550\u2550 ${passed}/${passed + failed} passed \u2550\u2550\u2550\n`,
  );
  if (failed > 0) process.exit(1);
}

run();
