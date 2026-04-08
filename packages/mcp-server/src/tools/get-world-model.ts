import { loadManifest, loadStageArtifact } from "../state.js";
import type { CompilerStageCode } from "@swm/compiler";

const VALID_STAGES = new Set<string>([
  "CTX",
  "INT",
  "PER",
  "ENT",
  "PRO",
  "SYN",
  "VER",
  "GOV",
]);

export function getWorldModel(stage?: string): {
  content: string;
  isError: boolean;
} {
  if (stage) {
    if (!VALID_STAGES.has(stage.toUpperCase())) {
      return {
        content: `Unknown stage "${stage}". Valid stages: CTX, INT, PER, ENT, PRO, SYN, VER, GOV`,
        isError: true,
      };
    }
    const artifact = loadStageArtifact(
      stage.toUpperCase() as CompilerStageCode,
    );
    if (artifact === null) {
      return {
        content: `No artifact found for stage "${stage}". Run ada init first.`,
        isError: true,
      };
    }
    return { content: JSON.stringify(artifact, null, 2), isError: false };
  }

  const manifest = loadManifest();
  if (!manifest) {
    return {
      content: "No compiled world model found. Run ada init first.",
      isError: true,
    };
  }

  return { content: JSON.stringify(manifest, null, 2), isError: false };
}
