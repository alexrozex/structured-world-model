import * as fs from "node:fs";
import * as path from "node:path";

export function proposeAmendment(
  stage: string,
  field: string,
  proposed: string,
  rationale: string,
  original?: string,
): { content: string; isError: boolean } {
  const projectDir =
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"])
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd();

  try {
    const amendmentsDir = path.join(projectDir, ".ada", "amendments");
    fs.mkdirSync(amendmentsDir, { recursive: true });

    const ts = Date.now();
    const filename = `${ts}-${stage.toUpperCase()}.json`;
    const filePath = path.join(amendmentsDir, filename);

    const record = {
      id: filename,
      createdAt: ts,
      stage: stage.toUpperCase(),
      field,
      original: original ?? null,
      proposed,
      rationale,
      status: "pending",
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");

    return {
      content: `Amendment proposed: ${stage.toUpperCase()}.${field}\nFile: .ada/amendments/${filename}\nRun 'ada review-amendments' to review the queue.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Failed to write amendment: ${message}`, isError: true };
  }
}
