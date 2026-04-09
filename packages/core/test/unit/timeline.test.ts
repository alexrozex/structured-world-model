import {
  createTimeline,
  addSnapshot,
  entityHistory,
  timelineSummary,
  snapshotChangelog,
} from "../../src/utils/timeline.js";
import type { WorldModelType } from "../../src/schema/index.js";

function makeModel(name: string, entityNames: string[]): WorldModelType {
  return {
    id: `wm_${name}`,
    name,
    description: `Model ${name}`,
    version: "0.1.0",
    created_at: new Date().toISOString(),
    entities: entityNames.map((n, i) => ({
      id: `ent_${i}`,
      name: n,
      type: "object" as const,
      description: `Entity ${n}`,
    })),
    relations: [],
    processes: [],
    constraints: [],
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
  console.log("═══ Timeline Unit Tests ═══\n");

  // Create timeline
  const tl = createTimeline("Test Timeline", "A test");
  assert(tl.snapshots.length === 0, "New timeline has 0 snapshots");
  assert(tl.name === "Test Timeline", "Timeline has correct name");

  // Add first snapshot
  const tl1 = addSnapshot(tl, makeModel("v1", ["User", "Database"]), "initial");
  assert(tl1.snapshots.length === 1, "After 1st snapshot: length is 1");
  assert(tl1.snapshots[0].label === "initial", "1st snapshot has label");
  assert(tl1.snapshots[0].stats.entities === 2, "1st snapshot: 2 entities");
  assert(
    tl1.snapshots[0].diff_from_previous === undefined,
    "1st snapshot: no diff (initial)",
  );

  // Add second snapshot with changes
  const tl2 = addSnapshot(
    tl1,
    makeModel("v2", ["User", "Database", "Cache"]),
    "added cache",
  );
  assert(tl2.snapshots.length === 2, "After 2nd snapshot: length is 2");
  assert(
    tl2.snapshots[1].diff_from_previous !== undefined,
    "2nd snapshot has diff",
  );
  assert(
    tl2.snapshots[1].diff_from_previous!.entities.added.length === 1,
    "Diff: 1 entity added",
  );
  assert(
    tl2.snapshots[1].diff_from_previous!.entities.added[0] === "Cache",
    "Diff: Cache was added",
  );

  // Add third snapshot with removal
  const tl3 = addSnapshot(
    tl2,
    makeModel("v3", ["User", "Cache"]),
    "removed database",
  );
  assert(tl3.snapshots.length === 3, "After 3rd snapshot: length is 3");
  assert(
    tl3.snapshots[2].diff_from_previous!.entities.removed.length === 1,
    "Diff: 1 entity removed",
  );
  assert(
    tl3.snapshots[2].diff_from_previous!.entities.removed[0] === "Database",
    "Diff: Database was removed",
  );

  // Entity history: User (present in all)
  const userHistory = entityHistory(tl3, "User");
  assert(userHistory.length === 3, "User history: 3 entries");
  assert(userHistory[0].event === "appeared", "User: appeared in snap 1");
  assert(userHistory[1].event === "unchanged", "User: unchanged in snap 2");
  assert(userHistory[2].event === "unchanged", "User: unchanged in snap 3");

  // Entity history: Database (appears then disappears)
  const dbHistory = entityHistory(tl3, "Database");
  assert(dbHistory.length === 3, "Database history: 3 entries");
  assert(dbHistory[0].event === "appeared", "Database: appeared in snap 1");
  assert(dbHistory[1].event === "unchanged", "Database: unchanged in snap 2");
  assert(
    dbHistory[2].event === "disappeared",
    "Database: disappeared in snap 3",
  );

  // Entity history: Cache (appears in snap 2)
  const cacheHistory = entityHistory(tl3, "Cache");
  assert(cacheHistory.length === 2, "Cache history: 2 entries (not in snap 1)");
  assert(cacheHistory[0].event === "appeared", "Cache: appeared in snap 2");

  // Entity history: nonexistent
  const nope = entityHistory(tl3, "Nonexistent");
  assert(nope.length === 0, "Nonexistent entity: empty history");

  // Timeline summary
  const summary = timelineSummary(tl3);
  assert(summary.includes("3"), "Summary mentions snapshot count");
  assert(summary.includes("Growth"), "Summary includes growth line");

  // ─── snapshotChangelog tests ─────────────────────────────────

  console.log("\n--- snapshotChangelog ---\n");

  // Test 1: Changelog with additions only
  {
    const t = createTimeline("changelog-test");
    const t1 = addSnapshot(t, makeModel("v1", ["User"]), "base");
    const t2 = addSnapshot(
      t1,
      makeModel("v2", ["User", "Cache", "Queue"]),
      "added services",
    );
    const log = snapshotChangelog(t2, 0, 1);
    assert(log.includes("+ Cache"), "Additions: shows Cache added");
    assert(log.includes("+ Queue"), "Additions: shows Queue added");
    assert(!log.includes("- User"), "Additions: User not removed");
    assert(log.includes("+2 / -0 / ~0"), "Additions: stats show +2/-0/~0");
  }

  // Test 2: Changelog with removals only
  {
    const t = createTimeline("removal-test");
    const t1 = addSnapshot(
      t,
      makeModel("v1", ["User", "Database", "Cache"]),
      "full",
    );
    const t2 = addSnapshot(t1, makeModel("v2", ["User"]), "trimmed");
    const log = snapshotChangelog(t2, 0, 1);
    assert(log.includes("- Database"), "Removals: shows Database removed");
    assert(log.includes("- Cache"), "Removals: shows Cache removed");
    assert(!log.includes("+ User"), "Removals: User not added");
    assert(log.includes("+0 / -2 / ~0"), "Removals: stats show +0/-2/~0");
  }

  // Test 3: Changelog with modifications
  {
    const t = createTimeline("modify-test");
    const modelA: WorldModelType = {
      id: "wm_a",
      name: "a",
      description: "Model a",
      version: "0.1.0",
      created_at: new Date().toISOString(),
      entities: [
        {
          id: "ent_0",
          name: "User",
          type: "actor" as const,
          description: "A person",
        },
        {
          id: "ent_1",
          name: "Database",
          type: "system" as const,
          description: "Stores data",
        },
      ],
      relations: [],
      processes: [],
      constraints: [],
    };
    const modelB: WorldModelType = {
      id: "wm_b",
      name: "b",
      description: "Model b",
      version: "0.1.0",
      created_at: new Date().toISOString(),
      entities: [
        {
          id: "ent_0",
          name: "User",
          type: "actor" as const,
          description: "An authenticated person",
        },
        {
          id: "ent_1",
          name: "Database",
          type: "resource" as const,
          description: "Stores data",
        },
      ],
      relations: [],
      processes: [],
      constraints: [],
    };
    const t1 = addSnapshot(t, modelA, "before");
    const t2 = addSnapshot(t1, modelB, "after");
    const log = snapshotChangelog(t2, 0, 1);
    assert(
      log.includes("~ User") && log.includes("description"),
      "Modifications: User description change detected",
    );
    assert(
      log.includes("~ Database") && log.includes("type: system -> resource"),
      "Modifications: Database type change detected",
    );
    assert(
      log.includes("+0 / -0 / ~2"),
      "Modifications: stats show ~2 changed",
    );
  }

  // Test 4: Empty changelog (identical snapshots)
  {
    const t = createTimeline("identical-test");
    const model = makeModel("v1", ["User", "Database"]);
    const t1 = addSnapshot(t, model, "first");
    const t2 = addSnapshot(t1, model, "same");
    const log = snapshotChangelog(t2, 0, 1);
    assert(
      log.includes("No changes detected"),
      "Identical: reports no changes",
    );
    assert(!log.includes("## Entities"), "Identical: no Entities section");
  }

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
