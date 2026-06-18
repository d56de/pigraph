// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { THEMES, type ThemeId } from "../src/lib/theme/themes.js";

describe("themes registry", () => {
  it("contains all three themes with full token sets", () => {
    const ids: ThemeId[] = ["obsidian", "aurora", "nord"];
    for (const id of ids) {
      const p = THEMES[id];
      expect(p.graph.background).toBeTypeOf("number");
      expect(p.graph.client).toBeTypeOf("number");
      expect(p.css.bg).toMatch(/^#|rgb/);
      expect(p.css.blocked).toMatch(/^#|rgb/);
    }
  });
});

describe("theme store", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to obsidian without a stored value", async () => {
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    expect(get(themeId)).toBe("obsidian");
  });

  it("persists a change to localStorage", async () => {
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    themeId.set("nord");
    expect(localStorage.getItem("pihole-viz-theme")).toBe("nord");
  });

  it("loads a stored value", async () => {
    localStorage.setItem("pihole-viz-theme", "aurora");
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    expect(get(themeId)).toBe("aurora");
  });
});
