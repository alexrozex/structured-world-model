import { PostcodeAddress, PostcodeCoordinate } from './postcode.js';

/**
 * SemanticNode: The primary unit of the Symmetric Contextual Cayley Graph.
 * Represents a discrete coordinate in the semantic state-space.
 */
export interface SemanticNode {
  readonly id: string; // The PostcodeAddress raw string
  readonly coordinate: PostcodeCoordinate;
  readonly content: unknown; // The IR fragment (Zod-validated)
  readonly provenance: readonly string[]; // IDs of parent nodes
  readonly entropy: number; // Estimated entropy reduction contribution
  readonly metadata?: Record<string, unknown>;
}

/**
 * SemanticEdge: A directional relationship between two SemanticNodes.
 */
export interface SemanticEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: "satisfies" | "derives" | "constrains" | "contains";
}

/**
 * GraphOperation: Atomic transformations on the Manifold state.
 */
export type GraphOperation =
  | { type: "ADD_NODE"; node: SemanticNode }
  | { type: "UPDATE_NODE"; nodeId: string; newNode: SemanticNode }
  | { type: "REMOVE_NODE"; nodeId: string }
  | { type: "ADD_EDGE"; edge: SemanticEdge }
  | { type: "REMOVE_EDGE"; edgeId: string };

/**
 * Permutation: A collective "Twist" of the Rubik's Cube.
 * A justified set of operations that moves the graph toward a Solved State.
 */
export interface Permutation {
  readonly id: string;
  readonly operations: readonly GraphOperation[];
  readonly justification: string; // Intent ID, Invariant ID, or Rationale
  readonly timestamp: number;
  readonly metadata: Record<string, unknown>;
}

/**
 * ManifoldState: The instantaneous configuration of the semantic world model.
 */
export interface ManifoldState {
  readonly ref: string; // The .ada/ref pointer (SHA of current state)
  readonly nodes: Record<string, SemanticNode>;
  readonly edges: readonly SemanticEdge[];
  readonly metrics: {
    readonly totalEntropy: number;
    readonly nodeCount: number;
    readonly invariantPassRate: number;
  };
}
