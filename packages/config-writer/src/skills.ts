import type { ProcessFlow } from "@swm/compiler";
import { renderFrontmatter, type SkillFile } from "./types.js";

export function workflowsToSkills(processFlow: ProcessFlow): SkillFile[] {
  const skills: SkillFile[] = [];

  for (const workflow of processFlow.workflows) {
    const name = workflow.name.toLowerCase().replace(/\s+/g, "-");
    const fileName = `${name}`;

    const steps = workflow.steps.map((step, i) => {
      return `${i + 1}. **${step.name}**
   - Pre: \`${step.hoareTriple.precondition}\`
   - Action: \`${step.hoareTriple.action}\`
   - Post: \`${step.hoareTriple.postcondition}\``;
    });

    const adaFrontmatter = renderFrontmatter({
      postcode: `ML.SKL.${name}/v1`,
      type: "skill",
      name,
      edges: {},
      compiledAt: Date.now(),
    });

    const body = `${adaFrontmatter}---
name: ${name}
description: "Use when ${workflow.trigger} pattern detected."
---

# ${workflow.name}

Trigger: ${workflow.trigger}

## Steps
${steps.join("\n\n")}
`;

    skills.push({
      name,
      description: `Use when ${workflow.trigger} pattern detected.`,
      body,
      path: `.claude/skills/${fileName}/SKILL.md`,
    });
  }

  return skills;
}
