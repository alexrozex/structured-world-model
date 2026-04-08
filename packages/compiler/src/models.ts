export const SONNET = "claude-sonnet-4-6" as const;
export const OPUS = "claude-opus-4-6" as const;

// Development mode: use SONNET for all stages to reduce cost (~20x cheaper).
// Set ADA_DEV_MODE=1 to enable. Production uses OPUS for SYN/VER/GOV.
export const DEV_OPUS = process.env["ADA_DEV_MODE"] === "1" ? SONNET : OPUS;

export type ModelId = typeof SONNET | typeof OPUS;
