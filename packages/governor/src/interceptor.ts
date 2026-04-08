import { Governor } from "./governor.js";

/**
 * createGovernedCanUseTool: Wraps Gemini's tool-call permission handler with
 * the synchronous Semantic Governor. This ensures that any tool call that
 * violates the manifold symmetry is blocked before it reaches the execution engine.
 */
export function createGovernedCanUseTool(
  governor: Governor,
  originalCanUseTool: any,
): any {
  return async (
    tool: any,
    input: any,
    toolUseContext: any,
    assistantMessage: any,
    toolUseID: string,
    forceDecision?: any,
  ) => {
    // 1. Synchronous Manifold Validation
    const validation = await governor.validate(tool.name, input);

    if (!validation.result) {
      // 2. Reject transition if illegal
      return {
        behavior: "deny",
        message:
          validation.message ||
          "Blocked by Semantic Governor: Manifold Invariant Violation",
        decisionReason: {
          type: "hook",
          hookName: "ManifoldGovernor",
          reason: validation.violatedInvariants?.join("; "),
        },
        toolUseID,
      };
    }

    // 3. Delegate to original permission logic (User / Settings / Classifier)
    return originalCanUseTool(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    );
  };
}
