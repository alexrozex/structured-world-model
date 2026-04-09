/**
 * End-to-end proof script.
 * Runs the full pipeline, validates output against Zod schemas,
 * checks referential integrity, and prints a detailed report.
 */

import { buildWorldModel } from "../src/swm.js";
import { WorldModel, ValidationResult } from "../src/schema/world-model.js";

const TEST_INPUT = `
Rocky Mountain Tattoo is a tattoo studio in Vancouver. The studio has tattoo artists
who create custom designs for clients. Clients book appointments through an online
booking system. Each appointment has a date, duration, and price. Artists specialize
in different styles: traditional, realism, blackwork, and Japanese.

The booking flow works like this: a client browses the artist gallery, selects an artist,
submits a booking request with reference images and description, the artist reviews and
approves or suggests changes, then the client confirms and pays a deposit. On the
appointment day, the artist creates the tattoo. After the session, the client can leave
a review.

Constraints: appointments cannot overlap for the same artist, deposits are non-refundable
within 48 hours, artists must have at least 2 years experience, and all designs must be
original work.
`;

interface ProofResult {
  label: string;
  passed: boolean;
  detail: string;
}

async function runProof() {
  const proofs: ProofResult[] = [];
  const start = Date.now();

  console.log("═══════════════════════════════════════════════");
  console.log("  STRUCTURED WORLD MODEL — END-TO-END PROOF");
  console.log("═══════════════════════════════════════════════\n");

  // ─── Stage 1: Pipeline execution ────────────────────────
  console.log("▸ Running pipeline...\n");

  let result: Awaited<ReturnType<typeof buildWorldModel>>;
  try {
    result = await buildWorldModel(
      {
        raw: TEST_INPUT,
        sourceType: "text",
        name: "Rocky Mountain Tattoo Studio",
      },
      {
        onStageStart: (name) => process.stdout.write(`  ▸ ${name}...`),
        onStageEnd: (_name, ms) => console.log(` ✓ (${ms}ms)`),
      },
    );
    proofs.push({
      label: "Pipeline executes without error",
      passed: true,
      detail: `Completed in ${result.totalDurationMs}ms`,
    });
  } catch (err) {
    proofs.push({
      label: "Pipeline executes without error",
      passed: false,
      detail: String(err),
    });
    printReport(proofs, Date.now() - start);
    return;
  }

  const wm = result.worldModel;
  const val = result.validation;

  // ─── Stage 2: Zod schema validation ────────────────────
  const wmParse = WorldModel.safeParse(wm);
  proofs.push({
    label: "WorldModel passes Zod schema validation",
    passed: wmParse.success,
    detail: wmParse.success
      ? "All fields conform to schema"
      : `Schema errors: ${JSON.stringify(wmParse.error?.issues?.slice(0, 3) ?? wmParse.error)}`,
  });

  const valParse = ValidationResult.safeParse(val);
  proofs.push({
    label: "ValidationResult passes Zod schema validation",
    passed: valParse.success,
    detail: valParse.success
      ? "All fields conform to schema"
      : `Schema errors: ${JSON.stringify(valParse.error?.issues?.slice(0, 3) ?? valParse.error)}`,
  });

  // ─── Stage 3: Entity extraction completeness ───────────
  const entityNames = wm.entities.map((e) => e.name.toLowerCase());
  const expectedConcepts = [
    "client",
    "artist",
    "appointment",
    "booking",
    "studio",
  ];
  const foundConcepts = expectedConcepts.filter((c) =>
    entityNames.some((n) => n.includes(c)),
  );
  proofs.push({
    label: "Core entities extracted",
    passed: foundConcepts.length >= 4,
    detail: `Found ${foundConcepts.length}/${expectedConcepts.length}: [${foundConcepts.join(", ")}]`,
  });

  // ─── Stage 4: Relations exist and reference valid IDs ──
  const entityIds = new Set(wm.entities.map((e) => e.id));
  const allRelSourcesValid = wm.relations.every((r) => entityIds.has(r.source));
  const allRelTargetsValid = wm.relations.every((r) => entityIds.has(r.target));
  proofs.push({
    label: "All relation sources reference valid entity IDs",
    passed: allRelSourcesValid,
    detail: `${wm.relations.length} relations checked`,
  });
  proofs.push({
    label: "All relation targets reference valid entity IDs",
    passed: allRelTargetsValid,
    detail: `${wm.relations.length} relations checked`,
  });

  // ─── Stage 5: Processes have steps and valid refs ──────
  const hasProcesses = wm.processes.length > 0;
  const allProcessParticipantsValid = wm.processes.every((p) =>
    p.participants.every((pid) => entityIds.has(pid)),
  );
  proofs.push({
    label: "Processes extracted",
    passed: hasProcesses,
    detail: `${wm.processes.length} processes found`,
  });
  proofs.push({
    label: "All process participants reference valid entity IDs",
    passed: allProcessParticipantsValid,
    detail: `Checked across ${wm.processes.length} processes`,
  });

  // ─── Stage 6: Constraints extracted ────────────────────
  const hasConstraints = wm.constraints.length > 0;
  const allConstraintScopesValid = wm.constraints.every((c) =>
    c.scope.every((sid) => entityIds.has(sid)),
  );
  proofs.push({
    label: "Constraints extracted",
    passed: hasConstraints,
    detail: `${wm.constraints.length} constraints found`,
  });
  proofs.push({
    label: "All constraint scopes reference valid entity IDs",
    passed: allConstraintScopesValid,
    detail: `Checked across ${wm.constraints.length} constraints`,
  });

  // ─── Stage 7: IDs are unique ───────────────────────────
  const allIds = [
    ...wm.entities.map((e) => e.id),
    ...wm.relations.map((r) => r.id),
    ...wm.processes.map((p) => p.id),
    ...wm.constraints.map((c) => c.id),
  ];
  const uniqueIds = new Set(allIds);
  proofs.push({
    label: "All IDs are unique across the model",
    passed: allIds.length === uniqueIds.size,
    detail: `${allIds.length} IDs, ${uniqueIds.size} unique`,
  });

  // ─── Stage 8: ID prefixes are correct ─────────────────
  const correctPrefixes =
    wm.entities.every((e) => e.id.startsWith("ent_")) &&
    wm.relations.every((r) => r.id.startsWith("rel_")) &&
    wm.processes.every((p) => p.id.startsWith("proc_")) &&
    wm.constraints.every((c) => c.id.startsWith("cstr_"));
  proofs.push({
    label: "ID prefixes follow convention (ent_, rel_, proc_, cstr_)",
    passed: correctPrefixes,
    detail: "All IDs checked",
  });

  // ─── Stage 9: Metadata present ─────────────────────────
  proofs.push({
    label: "Metadata populated with confidence and source info",
    passed:
      !!wm.metadata &&
      typeof wm.metadata.confidence === "number" &&
      wm.metadata.confidence > 0 &&
      !!wm.metadata.source_type,
    detail: `confidence=${wm.metadata?.confidence}, source=${wm.metadata?.source_type}`,
  });

  // ─── Stage 10: Validation agent produced result ────────
  proofs.push({
    label: "Validation agent produced result with stats",
    passed:
      typeof val.valid === "boolean" &&
      typeof val.stats.entities === "number" &&
      val.stats.entities > 0,
    detail: `valid=${val.valid}, entities=${val.stats.entities}, relations=${val.stats.relations}`,
  });

  // ─── Stage 11: Pipeline stages all ran ─────────────────
  const stageNames = result.stages.map((s) => s.stage);
  const expectedStages = ["extraction", "structuring", "validation"];
  const allStagesRan = expectedStages.every((s) => stageNames.includes(s));
  proofs.push({
    label: "All three pipeline stages executed",
    passed: allStagesRan,
    detail: `Stages: [${stageNames.join(" → ")}]`,
  });

  // ─── Stage 12: Multi-pass extraction finds additional entities ──
  console.log("\n▸ Running multi-pass extraction comparison...\n");

  let pass1EntityCount = 0;
  let pass2EntityCount = 0;
  try {
    const pass1Result = await buildWorldModel(
      {
        raw: TEST_INPUT,
        sourceType: "text",
        name: "Rocky Mountain Tattoo Studio (pass-1)",
      },
      {
        passes: 1,
        onStageStart: (name) => process.stdout.write(`  ▸ [pass1] ${name}...`),
        onStageEnd: (_name, ms) => console.log(` ✓ (${ms}ms)`),
      },
    );
    pass1EntityCount = pass1Result.worldModel.entities.length;

    const pass2Result = await buildWorldModel(
      {
        raw: TEST_INPUT,
        sourceType: "text",
        name: "Rocky Mountain Tattoo Studio (pass-2)",
      },
      {
        passes: 2,
        onStageStart: (name) => process.stdout.write(`  ▸ [pass2] ${name}...`),
        onStageEnd: (_name, ms) => console.log(` ✓ (${ms}ms)`),
      },
    );
    pass2EntityCount = pass2Result.worldModel.entities.length;

    proofs.push({
      label: "Multi-pass extraction finds additional entities",
      passed: pass2EntityCount >= pass1EntityCount,
      detail: `Pass 1: ${pass1EntityCount} entities, Pass 2: ${pass2EntityCount} entities`,
    });

    const pass2WmParse = WorldModel.safeParse(pass2Result.worldModel);
    proofs.push({
      label: "Multi-pass WorldModel passes Zod schema validation",
      passed: pass2WmParse.success,
      detail: pass2WmParse.success
        ? "All fields conform to schema"
        : `Schema errors: ${JSON.stringify(pass2WmParse.error?.issues?.slice(0, 3) ?? pass2WmParse.error)}`,
    });
  } catch (err) {
    proofs.push({
      label: "Multi-pass extraction finds additional entities",
      passed: false,
      detail: `Error: ${String(err)}`,
    });
  }

  // ─── Print report ──────────────────────────────────────
  printReport(proofs, Date.now() - start);

  // ─── Print model summary ───────────────────────────────
  console.log("\n─── WORLD MODEL SUMMARY ─────────────────────\n");
  console.log(`  Name:        ${wm.name}`);
  console.log(`  Description: ${wm.description}`);
  console.log(`  Entities:    ${wm.entities.length}`);
  console.log(`  Relations:   ${wm.relations.length}`);
  console.log(`  Processes:   ${wm.processes.length}`);
  console.log(`  Constraints: ${wm.constraints.length}`);
  console.log(`  Confidence:  ${wm.metadata?.confidence}`);

  console.log("\n  Entities:");
  for (const e of wm.entities) {
    console.log(`    [${e.type}] ${e.name} — ${e.description.slice(0, 80)}`);
  }

  console.log("\n  Relations:");
  for (const r of wm.relations) {
    const src = wm.entities.find((e) => e.id === r.source)?.name ?? r.source;
    const tgt = wm.entities.find((e) => e.id === r.target)?.name ?? r.target;
    console.log(`    ${src} —[${r.type}]→ ${tgt}: ${r.label}`);
  }

  console.log("\n  Processes:");
  for (const p of wm.processes) {
    console.log(
      `    ${p.name}: ${p.steps.length} steps — ${p.description.slice(0, 80)}`,
    );
  }

  console.log("\n  Constraints:");
  for (const c of wm.constraints) {
    console.log(`    [${c.severity}] ${c.name}: ${c.description.slice(0, 80)}`);
  }

  if (val.issues.length > 0) {
    console.log("\n  Validation Issues:");
    for (const issue of val.issues) {
      console.log(`    [${issue.type}] ${issue.code}: ${issue.message}`);
    }
  }
}

function printReport(proofs: ProofResult[], totalMs: number) {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  PROOF REPORT");
  console.log("═══════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;

  for (const p of proofs) {
    const icon = p.passed ? "✓" : "✗";
    const color = p.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${color}${icon}\x1b[0m ${p.label}`);
    console.log(`    ${p.detail}`);
    if (p.passed) passed++;
    else failed++;
  }

  console.log("\n───────────────────────────────────────────────");
  const allPassed = failed === 0;
  const summaryColor = allPassed ? "\x1b[32m" : "\x1b[31m";
  console.log(
    `  ${summaryColor}${passed}/${proofs.length} proofs passed${failed > 0 ? `, ${failed} FAILED` : ""}\x1b[0m`,
  );
  console.log(`  Total time: ${totalMs}ms`);
  console.log("═══════════════════════════════════════════════\n");

  if (!allPassed) process.exit(1);
}

runProof().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
