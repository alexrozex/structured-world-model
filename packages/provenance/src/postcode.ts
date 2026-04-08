import { createHash } from "node:crypto";

export type Layer = "L0G" | "L1S" | "L2I" | "L3E" | "L4A";
export type Concern = "ENT" | "FNC" | "REL" | "POL" | "EVT" | "MET" | "CFG" | "ERR";
export type Scope = "GLO" | "LOC" | "CMP" | "INT" | "EXT";
export type Dimension = "WHT" | "WHY" | "HOW" | "WHO" | "WEN" | "WRE" | "IFS" | "AMT";
export type Domain = "SFT" | "ORG" | "BIZ" | "OPS" | "COG" | "MED";

export interface PostcodeCoordinate {
  readonly layer: Layer;
  readonly concern: Concern;
  readonly scope: Scope;
  readonly dimension: Dimension;
  readonly domain: Domain;
}

/** Legacy support for Ada pipeline stages */
export type StageCode =
  | "CTX"
  | "INT"
  | "PER"
  | "ENT"
  | "PRO"
  | "SYN"
  | "VER"
  | "GOV"
  | "CFG"
  | "ORC"
  | "CLI"
  | "ELI"
  | "BLD";

const STAGE_TO_COORDINATE: Record<StageCode, PostcodeCoordinate> = {
  CTX: {
    layer: "L2I",
    concern: "CFG",
    scope: "GLO",
    dimension: "WHT",
    domain: "SFT",
  },
  INT: {
    layer: "L2I",
    concern: "ENT",
    scope: "GLO",
    dimension: "WHY",
    domain: "SFT",
  },
  PER: {
    layer: "L2I",
    concern: "ENT",
    scope: "GLO",
    dimension: "WHO",
    domain: "SFT",
  },
  ENT: {
    layer: "L2I",
    concern: "ENT",
    scope: "LOC",
    dimension: "WHT",
    domain: "SFT",
  },
  PRO: {
    layer: "L2I",
    concern: "FNC",
    scope: "LOC",
    dimension: "HOW",
    domain: "SFT",
  },
  SYN: {
    layer: "L2I",
    concern: "REL",
    scope: "GLO",
    dimension: "WHT",
    domain: "SFT",
  },
  VER: {
    layer: "L3E",
    concern: "POL",
    scope: "GLO",
    dimension: "IFS",
    domain: "SFT",
  },
  GOV: {
    layer: "L3E",
    concern: "POL",
    scope: "GLO",
    dimension: "IFS",
    domain: "SFT",
  },
  BLD: {
    layer: "L4A",
    concern: "CFG",
    scope: "GLO",
    dimension: "HOW",
    domain: "SFT",
  },
  CLI: {
    layer: "L3E",
    concern: "FNC",
    scope: "GLO",
    dimension: "HOW",
    domain: "COG",
  },
  ELI: {
    layer: "L2I",
    concern: "ENT",
    scope: "GLO",
    dimension: "WHT",
    domain: "COG",
  },
  CFG: {
    layer: "L4A",
    concern: "CFG",
    scope: "GLO",
    dimension: "HOW",
    domain: "SFT",
  },
  ORC: {
    layer: "L3E",
    concern: "FNC",
    scope: "GLO",
    dimension: "HOW",
    domain: "OPS",
  },
};

export interface PostcodeAddress {
  readonly prefix: "ML";
  readonly coordinate: PostcodeCoordinate;
  readonly hash: string;
  readonly version: number;
  readonly raw: string;
}

/**
 * Generates a 5-axis postcode address for a semantic node.
 * Format: ML.<LYR>.<CON>.<SCP>.<DIM>.<DOM>.<HASH>/v<VER>
 * Supports legacy StageCode for backward compatibility.
 */
export function generatePostcode(
  stageOrCoordinate: StageCode | PostcodeCoordinate,
  content: string,
  version: number = 1,
): PostcodeAddress {
  const coordinate =
    typeof stageOrCoordinate === "string"
      ? STAGE_TO_COORDINATE[stageOrCoordinate]
      : stageOrCoordinate;

  if (!coordinate) {
    throw new Error(`Invalid stage or coordinate: ${JSON.stringify(stageOrCoordinate)}`);
  }

  const hash = createHash("sha256").update(content).digest("hex").slice(0, 8);
  const { layer, concern, scope, dimension, domain } = coordinate;
  const raw = `ML.${layer}.${concern}.${scope}.${dimension}.${domain}.${hash}/v${version}`;
  return { prefix: "ML", coordinate, hash, version, raw };
}

/**
 * Parses a 5-axis postcode string into a PostcodeAddress object.
 */
export function parsePostcode(raw: string): PostcodeAddress | null {
  const match = raw.match(
    /^ML\.([A-Z0-9]{3})\.([A-Z0-9]{3})\.([A-Z0-9]{3})\.([A-Z0-9]{3})\.([A-Z0-9]{3})\.([a-f0-9]{8})\/v(\d+)$/,
  );
  if (!match) return null;

  const [, layer, concern, scope, dimension, domain, hash, version] = match;

  const coordinate: PostcodeCoordinate = {
    layer: layer as Layer,
    concern: concern as Concern,
    scope: scope as Scope,
    dimension: dimension as Dimension,
    domain: domain as Domain,
  };

  return {
    prefix: "ML",
    coordinate,
    hash: hash!,
    version: parseInt(version!, 10),
    raw,
  };
}

export function isValidPostcode(raw: string): boolean {
  return parsePostcode(raw) !== null;
}
