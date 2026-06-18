import { describe, expect, it } from "vitest";
import { domainRadius, clientRadius } from "../src/lib/render/sizes.js";

describe("node sizes", () => {
  it("grows logarithmically with hits and is capped", () => {
    expect(domainRadius(1)).toBeCloseTo(5);
    expect(domainRadius(10)).toBeGreaterThan(domainRadius(1));
    expect(domainRadius(100000)).toBeLessThanOrEqual(16);
    expect(clientRadius(1)).toBeCloseTo(10);
    expect(clientRadius(100000)).toBeLessThanOrEqual(26);
  });
});
