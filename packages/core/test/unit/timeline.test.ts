import {
  createTimeline,
  addSnapshot,
  entityHistory,
  timelineSummary,
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

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
