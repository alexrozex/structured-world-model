import { ManifoldStore, ManifoldState } from "@swm/provenance";
import { ManifoldChecker, ValidationResult } from "./manifold-checker.js";

/**
 * Governor: The central authority for semantic state transitions.
 * Enforces axioms and invariants by intercepting execution-layer permutations.
 */
export class Governor {
  private readonly store: ManifoldStore;
  private readonly checker: ManifoldChecker;
  private currentState: ManifoldState | null = null;

  constructor(projectDir: string) {
    this.store = new ManifoldStore(projectDir);
    this.checker = new ManifoldChecker();
  }

  /**
   * Synchronously validates a tool call against the current world model.
   */
  async validate(toolName: string, input: unknown): Promise<ValidationResult> {
    const state = await this.ensureState();
    if (!state) {
      // If no world model exists, we cannot govern. 
      // In a "strict" system, we might reject here. 
      // For now, allow but log a warning.
      return { result: true }; 
    }

    return this.checker.checkToolCall(state, toolName, input);
  }

  /**
   * Returns the current manifold state, loading it from the store if necessary.
   */
  async ensureState(): Promise<ManifoldState | null> {
    if (this.currentState) return this.currentState;

    const ref = this.store.loadRef();
    if (!ref) return null;

    try {
      this.currentState = this.store.loadManifold(ref);
      return this.currentState;
    } catch (e) {
      console.error("Failed to load manifold state from ref:", ref, e);
      return null;
    }
  }

  /**
   * Forces a reload of the manifold state (e.g., after a compilation iteration).
   */
  refresh(): void {
    this.currentState = null;
  }
}
