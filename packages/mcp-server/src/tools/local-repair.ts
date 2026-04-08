import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RepairAction = "retry" | "escalate" | "skip";

export interface FailureRecord {
  readonly componentName: string;
  readonly failureCount: number;
  readonly lastFailureAt: number;
  readonly failures: readonly {
    readonly description: string;
    readonly attemptNumber: number;
    readonly recordedAt: number;
  }[];
  readonly maxRetries: number;
  readonly status: "retrying" | "escalated" | "resolved";
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getProjectDir(): string {
  return (
    process.env["ADA_PROJECT_DIR"] ??
    (process.env["ADA_STATE_PATH"]
      ? path.dirname(process.env["ADA_STATE_PATH"]!)
      : null) ??
    process.env["CLAUDE_PROJECT_DIR"] ??
    process.cwd()
  );
}

function repairPath(projectDir: string): string {
  return path.join(projectDir, ".ada", "repair-state.json");
}

function loadRepairState(projectDir: string): FailureRecord[] {
  try {
    const raw = fs.readFileSync(repairPath(projectDir), "utf8");
    return JSON.parse(raw) as FailureRecord[];
  } catch {
    return [];
  }
}

function saveRepairState(projectDir: string, state: FailureRecord[]): void {
  fs.mkdirSync(path.join(projectDir, ".ada"), { recursive: true });
  fs.writeFileSync(
    repairPath(projectDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

/**
 * Reports a failure for a component and returns the repair directive.
 * If failures < maxRetries: returns "retry" with guidance.
 * If failures >= maxRetries: returns "escalate" — surface to human or macro planner.
 */
export function reportExecutionFailure(
  componentName: string,
  failureDescription: string,
  maxRetries: number = 3,
): { content: string; isError: boolean } {
  const projectDir = getProjectDir();

  try {
    const state = loadRepairState(projectDir);
    const now = Date.now();

    const existing = state.find(
      (r) => r.componentName === componentName && r.status === "retrying",
    );

    let record: FailureRecord;

    if (existing) {
      const newCount = existing.failureCount + 1;
      const newStatus: FailureRecord["status"] =
        newCount >= maxRetries ? "escalated" : "retrying";

      record = {
        ...existing,
        failureCount: newCount,
        lastFailureAt: now,
        status: newStatus,
        failures: [
          ...existing.failures,
          {
            description: failureDescription,
            attemptNumber: newCount,
            recordedAt: now,
          },
        ],
      };

      saveRepairState(
        projectDir,
        state.map((r) => (r === existing ? record : r)),
      );
    } else {
      record = {
        componentName,
        failureCount: 1,
        lastFailureAt: now,
        failures: [
          {
            description: failureDescription,
            attemptNumber: 1,
            recordedAt: now,
          },
        ],
        maxRetries,
        status: maxRetries <= 1 ? "escalated" : "retrying",
      };

      saveRepairState(projectDir, [...state, record]);
    }

    const action: RepairAction =
      record.status === "escalated" ? "escalate" : "retry";

    const remaining = record.maxRetries - record.failureCount;

    const lines: string[] = [
      `Failure recorded: ${componentName} (attempt ${record.failureCount}/${record.maxRetries})`,
      `Description: ${failureDescription}`,
      ``,
    ];

    if (action === "retry") {
      lines.push(
        `ACTION: RETRY — ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
        `Adjust your approach before the next attempt.`,
        `After ${remaining} more failure${remaining === 1 ? "" : "s"}, this will be escalated.`,
      );
    } else {
      lines.push(
        `ACTION: ESCALATE — max retries (${record.maxRetries}) reached.`,
        `Do NOT attempt again. Instead:`,
        `  1. Call ada.set_task_status("${componentName}", "in_progress", []) to mark as blocked`,
        `  2. Surface the failure to the macro planner via ada.report_gap`,
        `  3. Await human review or reassignment`,
      );
    }

    return { content: lines.join("\n"), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to record execution failure: ${message}`,
      isError: true,
    };
  }
}

/**
 * Marks a component's repair cycle as resolved — clears the failure record.
 * Call after a retry succeeds so future failures start from a clean count.
 */
export function resolveRepair(componentName: string): {
  content: string;
  isError: boolean;
} {
  const projectDir = getProjectDir();

  try {
    const state = loadRepairState(projectDir);
    const target = state.find((r) => r.componentName === componentName);

    if (!target) {
      return {
        content: `No active repair record for "${componentName}".`,
        isError: false,
      };
    }

    saveRepairState(
      projectDir,
      state.map((r) =>
        r === target ? { ...r, status: "resolved" as const } : r,
      ),
    );

    return {
      content: `Repair resolved: ${componentName}\nFailure count was: ${target.failureCount}. Record cleared.`,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to resolve repair: ${message}`,
      isError: true,
    };
  }
}
