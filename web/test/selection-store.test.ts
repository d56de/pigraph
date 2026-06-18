import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { clearSelection, selectNode, selectedId } from "../src/lib/detail/selection-store.js";

describe("selection store", () => {
  beforeEach(() => clearSelection());

  it("selects and clears a node id", () => {
    selectNode("client:10.0.0.1");
    expect(get(selectedId)).toBe("client:10.0.0.1");
    clearSelection();
    expect(get(selectedId)).toBeNull();
  });
});
