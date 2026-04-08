import { describe, it, expect } from "vitest";
import { generatePostcode, parsePostcode, PostcodeCoordinate } from './postcode.js';

describe("Postcode Address System", () => {
  const coordinate: PostcodeCoordinate = {
    layer: "L2I",
    concern: "ENT",
    scope: "LOC",
    dimension: "WHT",
    domain: "SFT",
  };

  it("generates a valid 5-axis postcode string", () => {
    const content = "example semantic node content";
    const address = generatePostcode(coordinate, content);

    expect(address.raw).toMatch(
      /^ML\.L2I\.ENT\.LOC\.WHT\.SFT\.[a-f0-9]{8}\/v1$/,
    );
  });

  it("parses a 5-axis postcode string back into a coordinate object", () => {
    const raw = "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/v2";
    const parsed = parsePostcode(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.coordinate).toEqual(coordinate);
    expect(parsed?.hash).toBe("abcdef12");
    expect(parsed?.version).toBe(2);
  });

  it("maintains round-trip integrity", () => {
    const content = "round trip test";
    const generated = generatePostcode(coordinate, content, 3);
    const parsed = parsePostcode(generated.raw);

    expect(parsed).toEqual(generated);
  });

  it("rejects malformed postcodes", () => {
    const invalidInputs = [
      "ML.L2.ENT.LOC.WHT.SFT.abc/v1", // wrong hash length
      "ML.L2I.ENT.LOC.WHT.SFT.abcdef12", // missing version
      "INVALID.POSTCODE",
      "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/vx", // non-numeric version
      "ML.L2I.ENT.LOC.WHT.SFT.abcdef12/v", // empty version
    ];

    invalidInputs.forEach((input) => {
      expect(parsePostcode(input)).toBeNull();
    });
  });
});
