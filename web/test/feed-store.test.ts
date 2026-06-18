import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import { feedOpen, toggleFeed, closeFeed } from "../src/lib/hud/feed-store.js";

describe("feed-store", () => {
  beforeEach(() => closeFeed());

  it("defaults to closed", () => {
    expect(get(feedOpen)).toBe(false);
  });
  it("toggleFeed flips the state", () => {
    toggleFeed();
    expect(get(feedOpen)).toBe(true);
    toggleFeed();
    expect(get(feedOpen)).toBe(false);
  });
  it("closeFeed forces closed", () => {
    toggleFeed();
    closeFeed();
    expect(get(feedOpen)).toBe(false);
  });
});
