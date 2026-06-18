import { describe, expect, it } from "vitest";
import { donutSegments } from "../src/lib/hud/donut.js";

describe("donutSegments", () => {
  it("returns cache/unbound/blocked arcs with cumulative rotation", () => {
    const segs = donutSegments({ cache: 50, unbound: 30, blocked: 20, total: 100 }, 100);
    expect(segs.map((s) => Math.round(s.dash))).toEqual([50, 30, 20]);
    expect(segs.map((s) => Math.round(s.rotate))).toEqual([0, 180, 288]);
    expect(segs.map((s) => s.color)).toEqual(["var(--allowed)", "var(--forwarded)", "var(--blocked)"]);
  });

  it("handles zero total without dividing by zero", () => {
    const segs = donutSegments({ cache: 0, unbound: 0, blocked: 0, total: 0 }, 100);
    expect(segs.every((s) => s.dash === 0)).toBe(true);
  });
});
