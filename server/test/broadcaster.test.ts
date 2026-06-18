import { describe, expect, it, vi } from "vitest";
import { Broadcaster } from "../src/broadcaster.js";

describe("Broadcaster", () => {
  it("delivers events to all subscribers until unsubscribe", () => {
    const b = new Broadcaster();
    const a = vi.fn();
    const c = vi.fn();
    const unsubA = b.subscribe(a);
    b.subscribe(c);

    const event = { type: "status", state: "online" } as const;
    b.broadcast(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(c).toHaveBeenCalledWith(event);

    unsubA();
    b.broadcast(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(2);
  });

  it("continues delivering when a subscriber throws", () => {
    const b = new Broadcaster();
    const throwing = vi.fn(() => {
      throw new Error("subscriber boom");
    });
    const healthy = vi.fn();
    b.subscribe(throwing);
    b.subscribe(healthy);

    const event = { type: "status", state: "online" } as const;
    expect(() => b.broadcast(event)).not.toThrow();
    expect(throwing).toHaveBeenCalledWith(event);
    expect(healthy).toHaveBeenCalledWith(event);
  });
});
