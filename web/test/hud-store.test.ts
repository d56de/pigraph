import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { FEED_LIMIT, applyServerEvent, hud, resetHud } from "../src/lib/hud/hud-store.js";

describe("hud store", () => {
  beforeEach(() => resetHud());

  it("updates counters from summary events", () => {
    applyServerEvent({
      type: "summary",
      totalQueries: 100,
      blockedQueries: 25,
      percentBlocked: 25,
      activeClients: 7,
    });
    expect(get(hud)).toMatchObject({ total: 100, blocked: 25, percent: 25, clients: 7 });
  });

  it("prepends feed items and caps the feed", () => {
    for (let i = 0; i < FEED_LIMIT + 3; i++) {
      applyServerEvent({
        type: "query",
        id: i,
        time: i,
        domain: `d${i}.com`,
        clientIp: "ip",
        clientName: "mac",
        blocked: i % 2 === 0,
        status: "GRAVITY",
      });
    }
    const { feed } = get(hud);
    expect(feed).toHaveLength(FEED_LIMIT);
    expect(feed[0].domain).toBe(`d${FEED_LIMIT + 2}.com`);
  });

  it("tracks connection status events", () => {
    applyServerEvent({ type: "status", state: "offline" });
    expect(get(hud).connected).toBe(false);
    applyServerEvent({ type: "status", state: "online" });
    expect(get(hud).connected).toBe(true);
  });

  it("stores cached/forwarded from summary", () => {
    resetHud();
    applyServerEvent({
      type: "summary", totalQueries: 100, blockedQueries: 8, percentBlocked: 8,
      activeClients: 5, cached: 60, forwarded: 32,
    });
    const s = get(hud);
    expect(s.cached).toBe(60);
    expect(s.forwarded).toBe(32);
  });

  it("tags feed items with their resolution origin", () => {
    resetHud();
    applyServerEvent({
      type: "query", id: 1, time: 1, domain: "a.com", clientIp: "10.0.0.1",
      clientName: "x", blocked: false, status: "FORWARDED",
    });
    expect(get(hud).feed[0].origin).toBe("unbound");
  });
});
