import * as fs from "node:fs";
import * as path from "node:path";

export type SubGoalStatus = "pending" | "in_progress" | "complete" | "failed";

export interface SubGoalExecution {
  readonly name: string;
  status: SubGoalStatus;
  sessionId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  evidence: string[];
  failureReason: string | null;
  attemptCount: number;
}

export interface SubGoalStateFile {
  runId: string;
  projectDir: string;
  createdAt: number;
  subGoals: SubGoalExecution[];
}

function statePath(projectDir: string): string {
  return path.join(projectDir, ".ada", "subgoal-state.json");
}

export function initSubGoalState(
  projectDir: string,
  runId: string,
  subGoalNames: readonly { name: string; dependsOn: readonly string[] }[],
): void {
  const adaDir = path.join(projectDir, ".ada");
  fs.mkdirSync(adaDir, { recursive: true });

  const state: SubGoalStateFile = {
    runId,
    projectDir,
    createdAt: Date.now(),
    subGoals: subGoalNames.map((sg) => ({
      name: sg.name,
      status: "pending",
      sessionId: null,
      startedAt: null,
      completedAt: null,
      evidence: [],
      failureReason: null,
      attemptCount: 0,
    })),
  };

  fs.writeFileSync(
    statePath(projectDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

export function loadSubGoalState(projectDir: string): SubGoalStateFile | null {
  const p = statePath(projectDir);
  if (!fs.existsSync(p)) return null;

  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as SubGoalStateFile;
  } catch {
    return null;
  }
}

export function saveSubGoalState(
  projectDir: string,
  state: SubGoalStateFile,
): void {
  const adaDir = path.join(projectDir, ".ada");
  fs.mkdirSync(adaDir, { recursive: true });
  fs.writeFileSync(
    statePath(projectDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

function mutateSubGoal(
  projectDir: string,
  name: string,
  mutate: (sg: SubGoalExecution) => void,
): void {
  const state = loadSubGoalState(projectDir);
  if (!state) {
    throw new Error(`No subgoal-state.json found in ${projectDir}/.ada/`);
  }

  const sg = state.subGoals.find((s) => s.name === name);
  if (!sg) {
    throw new Error(`SubGoal "${name}" not found in state file`);
  }

  mutate(sg);
  saveSubGoalState(projectDir, state);
}

export function markSubGoalInProgress(
  projectDir: string,
  name: string,
  sessionId: string,
): void {
  mutateSubGoal(projectDir, name, (sg) => {
    sg.status = "in_progress";
    sg.sessionId = sessionId;
    sg.startedAt = Date.now();
    sg.attemptCount += 1;
  });
}

export function markSubGoalComplete(
  projectDir: string,
  name: string,
  evidence: string[],
): void {
  mutateSubGoal(projectDir, name, (sg) => {
    sg.status = "complete";
    sg.completedAt = Date.now();
    sg.evidence = evidence;
    sg.failureReason = null;
  });
}

export function markSubGoalFailed(
  projectDir: string,
  name: string,
  reason: string,
): void {
  mutateSubGoal(projectDir, name, (sg) => {
    sg.status = "failed";
    sg.completedAt = Date.now();
    sg.failureReason = reason;
  });
}

export function getReadySubGoals(
  state: SubGoalStateFile,
  allSubGoals: readonly { name: string; dependsOn: readonly string[] }[],
): string[] {
  const completedNames = new Set(
    state.subGoals
      .filter((sg) => sg.status === "complete")
      .map((sg) => sg.name),
  );

  const pendingNames = new Set(
    state.subGoals.filter((sg) => sg.status === "pending").map((sg) => sg.name),
  );

  const ready: string[] = [];

  for (const spec of allSubGoals) {
    if (!pendingNames.has(spec.name)) continue;

    const allDepsComplete = spec.dependsOn.every((dep) =>
      completedNames.has(dep),
    );

    if (allDepsComplete) {
      ready.push(spec.name);
    }
  }

  return ready;
}
