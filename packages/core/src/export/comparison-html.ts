/**
 * HTML visualization of model comparison — shows entities side by side
 * with color-coded agreement/conflict indicators.
 */

import type { WorldModelType } from "../schema/index.js";
import type { CompareResult, Conflict } from "../utils/compare.js";
import { compare } from "../utils/compare.js";
import { coverage } from "../utils/coverage.js";

export interface ComparisonData {
  modelA: WorldModelType;
  modelB: WorldModelType;
  comparison: CompareResult;
  coverageAB: { overall: number; entityCoverage: number };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate a self-contained HTML page showing two models side by side
 * with color-coded agreement/conflict indicators.
 */
export function toComparisonHtml(a: WorldModelType, b: WorldModelType): string {
  const comp = compare(a, b);
  const cov = coverage(a, b);

  const conflictMap = new Map<string, Conflict>();
  for (const c of comp.conflicts) conflictMap.set(c.element.toLowerCase(), c);

  const aNames = new Set(a.entities.map((e) => e.name.toLowerCase()));
  const bNames = new Set(b.entities.map((e) => e.name.toLowerCase()));

  const entityRows = () => {
    const allNames = new Set([...aNames, ...bNames]);
    const rows: string[] = [];
    for (const name of [...allNames].sort()) {
      const inA = a.entities.find((e) => e.name.toLowerCase() === name);
      const inB = b.entities.find((e) => e.name.toLowerCase() === name);
      const conflict = conflictMap.get(name);
      const status = conflict
        ? "conflict"
        : inA && inB
          ? "match"
          : inA
            ? "only-a"
            : "only-b";
      const tooltip = conflict
        ? `${conflict.kind}: A="${conflict.modelA}" B="${conflict.modelB}"`
        : "";
      rows.push(`<tr class="${status}" title="${escapeHtml(tooltip)}">
        <td>${inA ? escapeHtml(inA.name) : "—"}</td>
        <td>${inA ? inA.type : "—"}</td>
        <td class="indicator">${status === "match" ? "✓" : status === "conflict" ? "⚠" : status === "only-a" ? "←" : "→"}</td>
        <td>${inB ? escapeHtml(inB.name) : "—"}</td>
        <td>${inB ? inB.type : "—"}</td>
      </tr>`);
    }
    return rows.join("\n");
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Model Comparison: ${escapeHtml(a.name)} vs ${escapeHtml(b.name)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; background: #0d1117; color: #c9d1d9; }
  h1 { color: #58a6ff; font-size: 1.5rem; }
  h2 { color: #8b949e; font-size: 1.1rem; margin-top: 2rem; }
  .stats { display: flex; gap: 2rem; margin: 1rem 0; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.5rem; }
  .stat-value { font-size: 2rem; font-weight: bold; }
  .stat-label { color: #8b949e; font-size: 0.85rem; }
  .grade-A .stat-value { color: #3fb950; }
  .grade-B .stat-value { color: #58a6ff; }
  .grade-C .stat-value { color: #d29922; }
  .grade-F .stat-value { color: #f85149; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th { background: #161b22; color: #8b949e; padding: 0.5rem; text-align: left; border-bottom: 1px solid #30363d; }
  td { padding: 0.5rem; border-bottom: 1px solid #21262d; }
  .indicator { text-align: center; font-size: 1.2rem; width: 3rem; }
  .match td { color: #c9d1d9; }
  .conflict td { color: #d29922; background: rgba(210,153,34,0.1); }
  .only-a td { color: #f85149; background: rgba(248,81,73,0.05); }
  .only-b td { color: #3fb950; background: rgba(63,185,80,0.05); }
  .legend { display: flex; gap: 1.5rem; margin: 1rem 0; font-size: 0.85rem; }
  .legend span { display: flex; align-items: center; gap: 0.3rem; }
</style>
</head>
<body>
<h1>Model Comparison</h1>
<p>${escapeHtml(a.name)} vs ${escapeHtml(b.name)}</p>

<div class="stats">
  <div class="stat ${cov.overall >= 0.75 ? "grade-A" : cov.overall >= 0.5 ? "grade-B" : "grade-F"}">
    <div class="stat-value">${Math.round(cov.overall * 100)}%</div>
    <div class="stat-label">Coverage</div>
  </div>
  <div class="stat">
    <div class="stat-value">${comp.agreements}</div>
    <div class="stat-label">Agreements</div>
  </div>
  <div class="stat ${comp.conflicts.length === 0 ? "grade-A" : "grade-C"}">
    <div class="stat-value">${comp.conflicts.length}</div>
    <div class="stat-label">Conflicts</div>
  </div>
  <div class="stat">
    <div class="stat-value">${a.entities.length} / ${b.entities.length}</div>
    <div class="stat-label">Entities (A / B)</div>
  </div>
</div>

<div class="legend">
  <span>✓ Match</span>
  <span style="color:#d29922">⚠ Conflict</span>
  <span style="color:#f85149">← Only in A</span>
  <span style="color:#3fb950">→ Only in B</span>
</div>

<h2>Entity Comparison</h2>
<table>
  <thead>
    <tr><th>Model A</th><th>Type</th><th></th><th>Model B</th><th>Type</th></tr>
  </thead>
  <tbody>
    ${entityRows()}
  </tbody>
</table>

<h2>Summary</h2>
<p>${escapeHtml(comp.summary)}</p>
<p style="color:#8b949e;font-size:0.8rem;margin-top:2rem">Generated by Structured World Model</p>
</body>
</html>`;
}
