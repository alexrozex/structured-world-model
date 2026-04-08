import * as fs from "node:fs";
import * as path from "node:path";

function getProjectDir(): string {
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"])
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

// ─── Implementation decision report ──────────────────────────────────────────
// Called by Claude Code when it makes a choice that deviates from the blueprint.
// Records are stored in .ada/feedback/ and injected into INT stage on --amend.

export function reportImplementationDecision(
  componentName: string,
  decision: string,
  rationale: string,
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();

  try {
    const feedbackDir = path.join(projectDir, ".ada", "feedback");
    fs.mkdirSync(feedbackDir, { recursive: true });

    const ts = Date.now();
    const filename = `decision-${ts}.json`;
    const filePath = path.join(feedbackDir, filename);

    const record = {
      type: "implementation_decision",
      id: filename,
      createdAt: ts,
      componentName,
      decision,
      rationale,
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");

    return {
      content: `Decision recorded for ${componentName}.\nFile: .ada/feedback/${filename}\nThis will be injected into the next 'ada compile --amend' run.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to record decision: ${message}`,
      isError: true,
    };
  }
}

// ─── Gap report ───────────────────────────────────────────────────────────────
// Called by Claude Code when the blueprint is missing something needed for
// implementation. Stored in .ada/feedback/ for injection on --amend.

export function reportGap(description: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();

  try {
    const feedbackDir = path.join(projectDir, ".ada", "feedback");
    fs.mkdirSync(feedbackDir, { recursive: true });

    const ts = Date.now();
    const filename = `gap-${ts}.json`;
    const filePath = path.join(feedbackDir, filename);

    const record = {
      type: "gap",
      id: filename,
      createdAt: ts,
      description,
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");

    return {
      content: `Gap recorded.\nFile: .ada/feedback/${filename}\nThis will be injected into the next 'ada compile --amend' run.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to record gap: ${message}`, isError: true };
  }
}
