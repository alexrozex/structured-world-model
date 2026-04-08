import { loadBlueprint } from "../state.js";

export function getBlueprint(): { content: string; isError: boolean } {
  const blueprint = loadBlueprint();
  if (!blueprint) {
    return { content: "No active blueprint found. Ensure ADA_STATE_PATH is set and state file exists.", isError: true };
  }
  return { content: JSON.stringify(blueprint, null, 2), isError: false };
}
