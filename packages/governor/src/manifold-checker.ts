import { ManifoldState, SemanticNode } from "@swm/provenance";

export interface ValidationResult {
  readonly result: boolean;
  readonly message?: string;
  readonly violatedInvariants?: string[];
}

/**
 * ManifoldChecker: Formal logic for verifying if a proposed "Twist" (tool call)
 * maintains the symmetry of the manifold.
 */
export class ManifoldChecker {
  /**
   * Evaluates a proposed tool call against the current manifold state.
   */
  async checkToolCall(
    state: ManifoldState,
    toolName: string,
    input: any,
  ): Promise<ValidationResult> {
    // 1. Identify relevant nodes based on tool input (e.g., file path)
    const affectedPath = this.getAffectedPath(toolName, input);
    if (!affectedPath) return { result: true }; // No path-based constraints

    // 2. Find bounded context for the path
    const contextNode = this.findBoundedContextNode(state, affectedPath);
    if (!contextNode) {
      // If no explicit context, fallback to global axioms/invariants
      return this.checkGlobalInvariants(state, toolName, input);
    }

    // 3. Retrieve and evaluate invariants for this context
    return this.evaluateInvariants(contextNode, state, toolName, input);
  }

  private getAffectedPath(toolName: string, input: any): string | null {
    if (toolName === "write_file" || toolName === "read_file") {
      return input.file_path || input.path || null;
    }
    if (toolName === "replace") {
      return input.file_path || null;
    }
    return null;
  }

  private findBoundedContextNode(
    state: ManifoldState,
    path: string,
  ): SemanticNode | null {
    // Look for L2I.ENT nodes (Entity Map) that define bounded contexts
    return (
      Object.values(state.nodes).find(
        (n) =>
          n.coordinate.concern === "ENT" &&
          path.toLowerCase().includes((n.content as any).name?.toLowerCase()),
      ) || null
    );
  }

  private evaluateInvariants(
    contextNode: SemanticNode,
    state: ManifoldState,
    toolName: string,
    input: any,
  ): ValidationResult {
    const invariants = (contextNode.content as any).invariants || [];
    const violations: string[] = [];

    for (const invariant of invariants) {
      const predicate =
        typeof invariant === "string" ? invariant : invariant.predicate;
      if (this.isViolated(predicate, toolName, input)) {
        violations.push(predicate);
      }
    }

    if (violations.length > 0) {
      return {
        result: false,
        message: `Manifold Invariant Violation: Tool call violates bounded context invariants for '${
          (contextNode.content as any).name
        }'`,
        violatedInvariants: violations,
      };
    }

    return { result: true };
  }

  private checkGlobalInvariants(
    state: ManifoldState,
    toolName: string,
    input: any,
  ): ValidationResult {
    // Placeholder for global axiom checks
    return { result: true };
  }

  private isViolated(predicate: string, toolName: string, input: any): boolean {
    const inputStr = JSON.stringify(input);

    if (predicate.includes("!== null") || predicate.includes("!= null")) {
      const field = predicate.split(".").pop()?.split(" ")[0];
      if (field && inputStr.includes(`"${field}": null`)) return true;
    }

    if (predicate.includes("> 0")) {
      const field = predicate.split(".").pop()?.split(" ")[0];
      if (field) {
        const match = inputStr.match(new RegExp(`"${field}":\\s*(-?\\d+)`));
        if (match && parseInt(match[1]!, 10) <= 0) return true;
      }
    }

    return false;
  }
}
