import { z } from "zod/v4";
import { WorldModel } from "./world-model.js";

/**
 * Export the WorldModel Zod schema as a JSON Schema object.
 */
export function getWorldModelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorldModel, { target: "draft-2020-12" });
}
