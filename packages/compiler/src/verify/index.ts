export {
  verify,
  loadBlueprintState,
  type VerifyOptions,
} from "./verification-engine.js";
export {
  scanCodebase,
  findSymbolByName,
  searchInFiles,
  type CodebaseSnapshot,
  type CodeSymbol,
} from "./codebase-scanner.js";
export {
  diffBlueprintAgainstCode,
  type DiffResult,
} from "./blueprint-differ.js";
export { formatTerminal, formatMarkdown } from "./formatter.js";
export type {
  VerificationReport,
  VerificationFinding,
  BoundedContextResult,
  ProvenanceTrace,
  FindingCategory,
  FindingSeverity,
} from "./types.js";
