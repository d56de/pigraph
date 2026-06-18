import { describe, expect, it } from "vitest";
import { resolutionOrigin } from "../src/lib/hud/resolution-origin.js";

describe("resolutionOrigin", () => {
  it("blocked wins regardless of status", () => {
    expect(resolutionOrigin("GRAVITY", true)).toBe("blocked");
    expect(resolutionOrigin("FORWARDED", true)).toBe("blocked");
  });
  it("classifies cache statuses", () => {
    expect(resolutionOrigin("CACHE", false)).toBe("cache");
    expect(resolutionOrigin("CACHE_STALE", false)).toBe("cache");
  });
  it("classifies forwarded as unbound", () => {
    expect(resolutionOrigin("FORWARDED", false)).toBe("unbound");
    expect(resolutionOrigin("FORWARD", false)).toBe("unbound");
  });
  it("everything else is other", () => {
    expect(resolutionOrigin("IN_PROGRESS", false)).toBe("other");
    expect(resolutionOrigin("UNKNOWN", false)).toBe("other");
  });
});
