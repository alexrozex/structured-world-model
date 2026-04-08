import type { PostcodeAddress } from "@swm/provenance";

export interface AdaNodeFrontmatter {
  readonly postcode: string;
  readonly type: "blueprint" | "agent" | "skill" | "hook" | "world-model";
  readonly name: string;
  readonly boundedContext?: string;
  readonly parentPostcode?: string; // blueprint postcode that produced this
  readonly edges: {
    readonly implements?: readonly string[]; // workflow names
    readonly dependsOn?: readonly string[]; // other agent/node postcodes
    readonly usesSkills?: readonly string[]; // skill names
  };
  readonly compiledAt: number;
}

export function renderFrontmatter(fm: AdaNodeFrontmatter): string {
  const lines = [
    "---",
    `ada_postcode: "${fm.postcode}"`,
    `ada_type: ${fm.type}`,
    `ada_name: ${fm.name}`,
  ];
  if (fm.boundedContext)
    lines.push(`ada_bounded_context: ${fm.boundedContext}`);
  if (fm.parentPostcode) lines.push(`ada_parent: "${fm.parentPostcode}"`);

  const { implements: impl, dependsOn, usesSkills } = fm.edges;
  if (
    (impl?.length ?? 0) > 0 ||
    (dependsOn?.length ?? 0) > 0 ||
    (usesSkills?.length ?? 0) > 0
  ) {
    lines.push("ada_edges:");
    if (impl && impl.length > 0) {
      lines.push("  implements:");
      for (const i of impl) lines.push(`    - "${i}"`);
    }
    if (dependsOn && dependsOn.length > 0) {
      lines.push("  depends_on:");
      for (const d of dependsOn) lines.push(`    - "${d}"`);
    }
    if (usesSkills && usesSkills.length > 0) {
      lines.push("  uses_skills:");
      for (const s of usesSkills) lines.push(`    - "${s}"`);
    }
  }
  lines.push(`ada_compiled_at: ${fm.compiledAt}`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export interface AgentFile {
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly status: string;
  readonly body: string;
  readonly path: string;
}

export interface SkillFile {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly path: string;
}

export interface HookScript {
  readonly name: string;
  readonly type: "pre-tool" | "post-tool";
  readonly matcher: string;
  readonly script: string;
  readonly path: string;
}

export interface ConfigGraph {
  readonly claudeMd: string;
  readonly buildMd: string | null;
  readonly agents: readonly string[];
  readonly skills: readonly string[];
  readonly hooks: readonly string[];
  readonly settings: string;
  readonly mcpJson: string;
  readonly contracts: readonly string[];
  readonly postcode: PostcodeAddress;
  readonly worldModelJson: string; // JSON-serialized WorldModel
  readonly worldModelMd: string; // human-readable world model MD
}
