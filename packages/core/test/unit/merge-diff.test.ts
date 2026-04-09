/**
 * Unit tests for merge and diff operations.
 */

import { mergeWorldModels, diffWorldModels, detectMergeConflicts } from "../../src/utils/merge.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(
  name: string,
  entities: Array<{ id: string; name: string }>,
  relations: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }> = [],
): WorldModelType {
  return {
    id: `wm_${name}`,
    name,
    description: `Model ${name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: entities.map((e) => ({
      ...e,
      type: "object" as const,
      description: `Entity ${e.name}`,
    })),
    relations: relations.map((r) => ({
      ...r,
      label: "test",
      type: r.type as WorldModelType["relations"][number]["type"],
    })),
    processes: [],
    constraints: [],
    metadata: {
      source_type: "text" as const,
      source_summary: "test",
      confidence: 0.8,
    },
  };
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function run() {
  console.log("═══ Merge & Diff Unit Tests ═══\n");

  // ─── Merge Tests ─────────────────────────────────────

  // Test 1: Basic merge unions entities
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "Admin" }]);
    const merged = mergeWorldModels(a, b);
    assert(merged.entities.length === 2, "Merge: unions distinct entities");
  }

  // Test 2: Merge deduplicates entities by name
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "User" }]);
    const merged = mergeWorldModels(a, b);
    assert(
      merged.entities.length === 1,
      "Merge: deduplicates same-name entities",
    );
  }

  // Test 3: Merge deduplicates case-insensitively
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "user" }]);
    const merged = mergeWorldModels(a, b);
    assert(
      merged.entities.length === 1,
      "Merge: case-insensitive entity dedup",
    );
  }

  // Test 4: Merge deduplicates relations
  {
    const a = makeModel(
      "A",
      [
        { id: "ent_1", name: "User" },
        { id: "ent_2", name: "DB" },
      ],
      [{ id: "rel_1", source: "ent_1", target: "ent_2", type: "uses" }],
    );
    const b = makeModel(
      "B",
      [
        { id: "ent_3", name: "User" },
        { id: "ent_4", name: "DB" },
      ],
      [{ id: "rel_2", source: "ent_3", target: "ent_4", type: "uses" }],
    );
    const merged = mergeWorldModels(a, b);
    assert(
      merged.relations.length === 1,
      "Merge: deduplicates identical relations after ID remap",
    );
  }

  // Test 5: Merge preserves custom name/description
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "Admin" }]);
    const merged = mergeWorldModels(a, b, {
      name: "Custom",
      description: "Custom desc",
    });
    assert(merged.name === "Custom", "Merge: respects custom name option");
    assert(
      merged.description === "Custom desc",
      "Merge: respects custom description option",
    );
  }

  // Test 6: Merge with empty models
  {
    const a = makeModel("A", []);
    const b = makeModel("B", [{ id: "ent_1", name: "User" }]);
    const merged = mergeWorldModels(a, b);
    assert(
      merged.entities.length === 1,
      "Merge: handles empty model + non-empty model",
    );
  }

  // Test 7: Merge two empty models
  {
    const a = makeModel("A", []);
    const b = makeModel("B", []);
    const merged = mergeWorldModels(a, b);
    assert(merged.entities.length === 0, "Merge: handles two empty models");
  }

  // ─── Diff Tests ──────────────────────────────────────

  // Test 8: Identical models produce no diff
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const diff = diffWorldModels(a, a);
    assert(
      diff.summary === "No changes",
      "Diff: identical models = no changes",
    );
  }

  // Test 9: Added entities detected
  {
    const before = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const after = makeModel("A", [
      { id: "ent_1", name: "User" },
      { id: "ent_2", name: "Admin" },
    ]);
    const diff = diffWorldModels(before, after);
    assert(diff.entities.added.length === 1, "Diff: detects added entities");
    assert(
      diff.entities.added[0] === "Admin",
      "Diff: added entity has correct name",
    );
  }

  // Test 10: Removed entities detected
  {
    const before = makeModel("A", [
      { id: "ent_1", name: "User" },
      { id: "ent_2", name: "Admin" },
    ]);
    const after = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const diff = diffWorldModels(before, after);
    assert(
      diff.entities.removed.length === 1,
      "Diff: detects removed entities",
    );
    assert(
      diff.entities.removed[0] === "Admin",
      "Diff: removed entity has correct name",
    );
  }

  // Test 11: Modified entities detected
  {
    const before = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const after: WorldModelType = {
      ...makeModel("A", [{ id: "ent_1", name: "User" }]),
      entities: [
        {
          id: "ent_1",
          name: "User",
          type: "actor",
          description: "Changed description",
        },
      ],
    };
    const diff = diffWorldModels(before, after);
    assert(
      diff.entities.modified.length === 1,
      "Diff: detects modified entities",
    );
  }

  // Test 12: Diff summary includes counts
  {
    const before = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const after = makeModel("A", [
      { id: "ent_1", name: "User" },
      { id: "ent_2", name: "Admin" },
      { id: "ent_3", name: "System" },
    ]);
    const diff = diffWorldModels(before, after);
    assert(
      diff.summary.includes("+2 entities"),
      "Diff: summary includes entity count",
    );
  }

  // Test 13: Confidence boost on merge (cross-validated entities)
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    a.entities[0].confidence = 0.6;
    const b = makeModel("B", [{ id: "ent_2", name: "User" }]);
    b.entities[0].confidence = 0.7;
    const merged = mergeWorldModels(a, b);
    const user = merged.entities.find((e) => e.name === "User");
    assert(user !== undefined, "Confidence merge: entity exists");
    assert(
      user!.confidence !== undefined && user!.confidence > 0.7,
      "Confidence merge: boosted above either input",
    );
    assert(user!.confidence! <= 1, "Confidence merge: capped at 1");
  }

  // Test 14: Unique entities keep original confidence
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    a.entities[0].confidence = 0.4;
    const b = makeModel("B", [{ id: "ent_2", name: "Admin" }]);
    b.entities[0].confidence = 0.9;
    const merged = mergeWorldModels(a, b);
    const admin = merged.entities.find((e) => e.name === "Admin");
    assert(admin?.confidence === 0.9, "Confidence unique: Admin keeps 0.9");
  }

  // ─── Conflict Detection Tests ────────────────────────────────────

  // Test 15: No conflicts for distinct entities
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "Admin" }]);
    const conflicts = detectMergeConflicts(a, b);
    assert(conflicts.length === 0, "Conflict: no conflicts for distinct entities");
  }

  // Test 16: No conflicts when same entity has same type and description
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "User" }]);
    // makeModel gives same description "Entity User" and same type "object"
    const conflicts = detectMergeConflicts(a, b);
    assert(conflicts.length === 0, "Conflict: no conflict when identical");
  }

  // Test 17: Detects description conflict
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "User" }]);
    b.entities[0].description = "A different description of User";
    const conflicts = detectMergeConflicts(a, b);
    const descConflict = conflicts.find((c) => c.field === "description");
    assert(descConflict !== undefined, "Conflict: detects description conflict");
    assert(descConflict?.entityName === "User", "Conflict: conflict names the entity");
    assert(descConflict?.valueA === "Entity User", "Conflict: reports model A description");
    assert(
      descConflict?.valueB === "A different description of User",
      "Conflict: reports model B description",
    );
  }

  // Test 18: Detects type conflict
  {
    const a = makeModel("A", [{ id: "ent_1", name: "Service" }]);
    a.entities[0].type = "system";
    const b = makeModel("B", [{ id: "ent_2", name: "Service" }]);
    b.entities[0].type = "actor";
    const conflicts = detectMergeConflicts(a, b);
    const typeConflict = conflicts.find((c) => c.field === "type");
    assert(typeConflict !== undefined, "Conflict: detects type conflict");
    assert(typeConflict?.valueA === "system", "Conflict: type A is 'system'");
    assert(typeConflict?.valueB === "actor", "Conflict: type B is 'actor'");
  }

  // Test 19: Multiple entities can have conflicts
  {
    const a = makeModel("A", [
      { id: "ent_1", name: "User" },
      { id: "ent_2", name: "DB" },
    ]);
    const b = makeModel("B", [
      { id: "ent_3", name: "User" },
      { id: "ent_4", name: "DB" },
    ]);
    b.entities[0].description = "Changed User desc";
    b.entities[1].description = "Changed DB desc";
    const conflicts = detectMergeConflicts(a, b);
    assert(conflicts.length === 2, "Conflict: reports conflicts for multiple entities");
    assert(
      conflicts.some((c) => c.entityName === "User"),
      "Conflict: User conflict reported",
    );
    assert(
      conflicts.some((c) => c.entityName === "DB"),
      "Conflict: DB conflict reported",
    );
  }

  // Test 20: Conflicts are noted in merged model's extraction_notes
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "User" }]);
    b.entities[0].description = "Different User description";
    const merged = mergeWorldModels(a, b);
    const notes = merged.metadata?.extraction_notes ?? [];
    assert(
      notes.some((n) => n.includes("Conflict") && n.includes("User")),
      "Conflict: merge notes contain conflict report",
    );
    assert(
      notes.some((n) => n.includes("kept A's value")),
      "Conflict: merge notes indicate which value was kept",
    );
  }

  // Test 21: Case-insensitive conflict detection
  {
    const a = makeModel("A", [{ id: "ent_1", name: "User" }]);
    const b = makeModel("B", [{ id: "ent_2", name: "user" }]);
    b.entities[0].description = "Different description";
    const conflicts = detectMergeConflicts(a, b);
    assert(
      conflicts.some((c) => c.field === "description"),
      "Conflict: detects conflict case-insensitively",
    );
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
