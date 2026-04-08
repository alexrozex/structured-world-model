import type { PostcodeAddress } from "@swm/provenance";

export interface TypeField {
  readonly name: string;
  readonly type: string;
}

export interface TypeRegistryEntry {
  readonly name: string;
  readonly kind: "interface" | "type";
  readonly fields: readonly TypeField[];
  readonly sourcePackage: string;
  readonly sourcePath: string;
}

export interface ConstantEntry {
  readonly name: string;
  readonly value: string;
  readonly sourcePackage: string;
  readonly sourcePath: string;
}

export interface PackageBoundary {
  readonly name: string;
  readonly types: readonly string[];
  readonly classNames: readonly string[];
  readonly dependencies: readonly string[];
}

export interface CodebaseContext {
  readonly typeRegistry: readonly TypeRegistryEntry[];
  readonly vocabulary: readonly string[];
  readonly constants: readonly ConstantEntry[];
  readonly packageBoundaries: readonly PackageBoundary[];
  readonly postcode: PostcodeAddress;
}

// Prior compiled blueprint — injected into INT and SYN stages during --amend runs.
// Allows new intent to be additive rather than a full replacement.
export interface PriorBlueprintContext {
  readonly summary: string;
  readonly architecturePattern: string;
  readonly components: readonly {
    name: string;
    responsibility: string;
    boundedContext: string;
  }[];
  readonly goals: readonly { id: string; description: string }[];
  readonly constraints: readonly { id: string; description: string }[];
  readonly excludedConcerns: readonly string[];
}
