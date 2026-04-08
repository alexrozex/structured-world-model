import type { VerificationReport, VerificationFinding } from "./types.js";

// ─── Terminal output ─────────────────────────────────────────────────────────

export function formatTerminal(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  ${report.passed ? "PASS" : "FAIL"}  ada verify  blueprint: ${report.blueprintPostcode}`,
  );
  lines.push("");

  // Coverage bars
  lines.push(
    `  Entity coverage:    ${bar(report.entityCoverage)} ${pct(report.entityCoverage)}`,
  );
  // Show honest three-tier invariant breakdown when available
  if (report.invariantTiers && report.invariantTiers.total > 0) {
    const t = report.invariantTiers;
    const enforcedPct = pct(t.enforced / t.total);
    const mentionedPct = pct(t.mentioned / t.total);
    const presentPct = pct(t.present / t.total);
    lines.push(
      `  Invariant enforced: ${bar(t.enforced / t.total)} ${enforcedPct}  (full expression found)`,
    );
    lines.push(
      `  Invariant mentioned:${bar(t.mentioned / t.total)} ${mentionedPct}  (property name found)`,
    );
    lines.push(
      `  Invariant present:  ${bar(t.present / t.total)} ${presentPct}  (keyword found)`,
    );
  } else {
    lines.push(
      `  Invariant coverage: ${bar(report.invariantCoverage)} ${pct(report.invariantCoverage)}`,
    );
  }
  lines.push(
    `  Component coverage: ${bar(report.componentCoverage)} ${pct(report.componentCoverage)}`,
  );
  lines.push(
    `  Overall:            ${bar(report.overallScore)} ${pct(report.overallScore)}`,
  );
  lines.push("");

  // Bounded context summary
  if (report.contextResults.length > 0) {
    lines.push("  Bounded Contexts:");
    for (const ctx of report.contextResults) {
      const entityPct =
        ctx.entitiesExpected > 0
          ? `${ctx.entitiesFound}/${ctx.entitiesExpected}`
          : "n/a";
      const invPct =
        ctx.invariantsExpected > 0
          ? `${ctx.invariantsEnforced}/${ctx.invariantsExpected}`
          : "n/a";
      const findingCount = ctx.findings.length;
      lines.push(
        `    ${ctx.contextName}  entities:${entityPct}  invariants:${invPct}  findings:${findingCount}`,
      );
    }
    lines.push("");
  }

  // Findings
  if (report.findings.length > 0) {
    const critical = report.findings.filter((f) => f.severity === "critical");
    const major = report.findings.filter((f) => f.severity === "major");
    const minor = report.findings.filter((f) => f.severity === "minor");

    lines.push(
      `  Findings: ${report.findings.length} total (${critical.length} critical, ${major.length} major, ${minor.length} minor)`,
    );
    lines.push("");

    for (const f of report.findings) {
      lines.push(formatFindingTerminal(f));
    }
  } else {
    lines.push("  No findings above confidence threshold.");
  }

  lines.push("");
  lines.push(`  Postcode: ${report.postcode.raw}`);
  lines.push("");

  return lines.join("\n");
}

function formatFindingTerminal(f: VerificationFinding): string {
  const severity =
    f.severity === "critical"
      ? "CRIT"
      : f.severity === "major"
        ? "MAJR"
        : "MINR";
  const location = f.filePath
    ? f.lineRange
      ? `${f.filePath}:${f.lineRange.start}`
      : f.filePath
    : "";

  let out = `  [${severity}] ${f.title}  (confidence:${f.confidence})`;
  if (location) out += `\n         ${location}`;
  if (f.provenance.blueprintEntity) {
    out += `\n         entity: ${f.provenance.blueprintEntity}`;
  }
  if (f.provenance.blueprintInvariant) {
    out += `\n         invariant: ${f.provenance.blueprintInvariant}`;
  }
  if (f.provenance.intentPhrase) {
    out += `\n         traces to: "${f.provenance.intentPhrase.slice(0, 80)}"`;
  }
  out += "\n";

  return out;
}

// ─── GitHub PR comment markdown ──────────────────────────────────────────────

export function formatMarkdown(
  report: VerificationReport,
  repoUrl?: string,
  sha?: string,
): string {
  const lines: string[] = [];

  lines.push(
    `## ${report.passed ? "Verification Passed" : "Verification Failed"}`,
  );
  lines.push("");
  lines.push(`Blueprint: \`${report.blueprintPostcode}\``);
  lines.push("");

  // Coverage table
  lines.push("| Metric | Coverage |");
  lines.push("|--------|----------|");
  lines.push(`| Entity | ${pct(report.entityCoverage)} |`);
  lines.push(`| Invariant | ${pct(report.invariantCoverage)} |`);
  lines.push(`| Component | ${pct(report.componentCoverage)} |`);
  lines.push(`| **Overall** | **${pct(report.overallScore)}** |`);
  lines.push("");

  // Context summary
  if (report.contextResults.length > 0) {
    lines.push("### Bounded Contexts");
    lines.push("");
    lines.push("| Context | Entities | Invariants | Findings |");
    lines.push("|---------|----------|------------|----------|");
    for (const ctx of report.contextResults) {
      lines.push(
        `| ${ctx.contextName} | ${ctx.entitiesFound}/${ctx.entitiesExpected} | ${ctx.invariantsEnforced}/${ctx.invariantsExpected} | ${ctx.findings.length} |`,
      );
    }
    lines.push("");
  }

  // Findings
  if (report.findings.length > 0) {
    lines.push(`### Findings (${report.findings.length})`);
    lines.push("");

    for (const f of report.findings) {
      lines.push(formatFindingMarkdown(f, repoUrl, sha));
    }
  } else {
    lines.push("No findings above confidence threshold.");
  }

  lines.push("");
  lines.push(`---`);
  lines.push(`Postcode: \`${report.postcode.raw}\``);

  return lines.join("\n");
}

function formatFindingMarkdown(
  f: VerificationFinding,
  repoUrl?: string,
  sha?: string,
): string {
  const icon =
    f.severity === "critical" ? "🔴" : f.severity === "major" ? "🟡" : "⚪";
  let out = `${icon} **${f.title}** (${f.severity}, confidence: ${f.confidence})\n`;
  out += `> ${f.description}\n`;

  if (f.filePath && repoUrl && sha) {
    const lineAnchor = f.lineRange
      ? `#L${f.lineRange.start}-L${f.lineRange.end}`
      : "";
    out += `> [${f.filePath}${f.lineRange ? `:${f.lineRange.start}` : ""}](${repoUrl}/blob/${sha}/${f.filePath}${lineAnchor})\n`;
  } else if (f.filePath) {
    out += `> \`${f.filePath}${f.lineRange ? `:${f.lineRange.start}` : ""}\`\n`;
  }

  if (f.provenance.intentPhrase) {
    out += `> Traces to intent: _"${f.provenance.intentPhrase.slice(0, 100)}"_\n`;
  }

  out += "\n";
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bar(ratio: number): string {
  const width = 20;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}
