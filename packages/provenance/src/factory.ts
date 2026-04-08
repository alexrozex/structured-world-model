import { generatePostcode, isValidPostcode } from "./postcode.js";
import type {
  PostcodeAddress,
  PostcodeCoordinate,
  StageCode,
} from "./postcode.js";
import type { ProvenanceRecord } from "./store.js";

const VALID_STAGE_CODES: readonly StageCode[] = [
  "CTX",
  "INT",
  "PER",
  "ENT",
  "PRO",
  "SYN",
  "VER",
  "GOV",
  "CFG",
  "ORC",
  "CLI",
  "ELI",
  "BLD",
];

/**
 * PostcodeAddressFactory
 *
 * Creates and validates PostcodeAddress instances with the required ML prefix,
 * constructs ProvenanceRecord entries, and resolves StageCode values.
 *
 * Invariants:
 *   - prefix is always "ML"
 *   - hash is non-null and non-empty
 *   - version is >= 1
 */
export class PostcodeAddressFactory {
  private readonly defaultCoordinate: PostcodeCoordinate;

  constructor(
    coordinate: PostcodeCoordinate = {
      layer: "L2I",
      concern: "ENT",
      scope: "LOC",
      dimension: "WHT",
      domain: "SFT",
    },
  ) {
    this.defaultCoordinate = coordinate;
  }

  createPostcode(content: string, version: number): PostcodeAddress {
    return generatePostcode(this.defaultCoordinate, content, version);
  }

  validatePostcode(address: PostcodeAddress): boolean {
    return (
      address.prefix === "ML" &&
      isValidPostcode(address.raw) &&
      address.hash.length > 0 &&
      address.version >= 1
    );
  }

  createProvenanceRecord(
    coordinate: PostcodeCoordinate,
    content: string,
    upstreamPostcodes: PostcodeAddress[],
  ): ProvenanceRecord {
    const address = generatePostcode(coordinate, content);
    return {
      postcode: address.raw,
      stage: coordinate.layer,
      upstreamPostcodes: upstreamPostcodes.map((p) => p.raw),
      content,
      timestamp: Date.now(),
    };
  }

  resolveStageCode(stage: string): StageCode {
    const upper = stage.toUpperCase() as StageCode;
    if (!VALID_STAGE_CODES.includes(upper)) {
      throw new Error(
        `Unknown stage code: "${stage}". Valid codes: ${VALID_STAGE_CODES.join(", ")}`,
      );
    }
    return upper;
  }
}
