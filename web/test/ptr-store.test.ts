// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

describe("hidePtr store", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to true (PTR hidden) without a stored value", async () => {
    vi.resetModules();
    const { hidePtr } = await import("../src/lib/filter/ptr-store.js");
    expect(get(hidePtr)).toBe(true);
  });

  it("persists a change to localStorage", async () => {
    vi.resetModules();
    const { hidePtr } = await import("../src/lib/filter/ptr-store.js");
    hidePtr.set(false);
    expect(localStorage.getItem("pihole-viz-hide-ptr")).toBe("false");
  });

  it("loads a stored false value", async () => {
    localStorage.setItem("pihole-viz-hide-ptr", "false");
    vi.resetModules();
    const { hidePtr } = await import("../src/lib/filter/ptr-store.js");
    expect(get(hidePtr)).toBe(false);
  });
});
