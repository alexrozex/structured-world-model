import type { MotherCompiler, CompileResult, CompileOptions } from "@swm/compiler";

export async function runCompileLoop(
  intent: string,
  compiler: MotherCompiler,
  options: CompileOptions,
  maxIterations: number = 3
): Promise<CompileResult> {
  let currentIntent = intent;
  let iterationCount = 0;
  let lastResult: CompileResult | null = null;

  while (iterationCount < maxIterations) {
    iterationCount++;
    lastResult = await compiler.compile(currentIntent, options);
    const decision = lastResult.governorDecision.decision;

    if (decision === "ACCEPT") {
      return { ...lastResult, status: "accepted", iterationCount };
    }
    if (decision === "REJECT") {
      return { ...lastResult, status: "rejected", iterationCount };
    }

    // ITERATE — append correction, do not replace original intent
    if (lastResult.governorDecision.nextAction) {
      currentIntent = `${intent}\n\nITERATION ${iterationCount} CORRECTION: ${lastResult.governorDecision.nextAction}`;
    }
  }

  return { ...lastResult!, status: "halted", iterationCount };
}
