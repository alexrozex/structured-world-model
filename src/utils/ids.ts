import { randomBytes } from "node:crypto";

export function genId(prefix: string): string {
  const hex = randomBytes(6).toString("hex");
  return `${prefix}_${hex}`;
}
