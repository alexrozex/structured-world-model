import { loadBlueprint } from "../state.js";

export function getWorkflow(workflowName: string): { content: string; isError: boolean } {
  const blueprint = loadBlueprint();
  if (!blueprint) {
    return { content: "No active blueprint found.", isError: true };
  }

  const workflow = blueprint.processModel.workflows.find(
    (wf) => wf.name.toLowerCase() === workflowName.toLowerCase()
  );
  if (!workflow) {
    return { content: `Workflow "${workflowName}" not found in blueprint.`, isError: true };
  }

  const spec = {
    name: workflow.name,
    trigger: workflow.trigger,
    steps: workflow.steps.map((s) => ({
      name: s.name,
      precondition: s.hoareTriple.precondition,
      action: s.hoareTriple.action,
      postcondition: s.hoareTriple.postcondition,
    })),
  };

  return { content: JSON.stringify(spec, null, 2), isError: false };
}
