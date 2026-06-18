import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryEvent, ServerEvent } from "@pihole-viz/shared";
import { QueryPoller } from "../src/poller.js";

function q(id: number, time: number): QueryEvent {
  return {
    type: "query",
    id,
    time,
    domain: `d${id}.example.com`,
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: false,
    status: "FORWARDED",
  };
}

const SUMMARY = {
  type: "summary",
  totalQueries: 1,
  blockedQueries: 0,
  percentBlocked: 0,
  activeClients: 1,
} as const;

describe("QueryPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits new queries in time order and dedupes by id", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi
        .fn()
        .mockResolvedValueOnce([q(2, 1002), q(1, 1001)])
        .mockResolvedValueOnce([q(2, 1002), q(3, 1003)]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.filter((e) => e.type === "query").map((e) => (e as QueryEvent).id)).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(events.filter((e) => e.type === "query").map((e) => (e as QueryEvent).id)).toEqual([1, 2, 3]);
    poller.stop();
  });

  it("emits offline on failure, backs off, and emits online on recovery", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "status", state: "offline" });

    // Backoff: nächster Versuch nach 2000ms, nicht 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: "status", state: "online" });
    poller.stop();
  });

  it("fetches summary every N polls", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi.fn().mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 2,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // Poll 1 -> Summary
    await vi.advanceTimersByTimeAsync(1000); // Poll 2
    await vi.advanceTimersByTimeAsync(1000); // Poll 3 -> Summary
    expect(client.fetchSummary).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "summary")).toHaveLength(2);
    poller.stop();
  });

  it("emits summary on every poll when summaryEveryNPolls is 1", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi.fn().mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 1,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // Poll 1
    await vi.advanceTimersByTimeAsync(1000); // Poll 2
    await vi.advanceTimersByTimeAsync(1000); // Poll 3
    expect(client.fetchSummary).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => e.type === "summary")).toHaveLength(3);
    poller.stop();
  });

  it("broadcasts a clients event on the topClients cadence", async () => {
    const events: string[] = [];
    const client = {
      fetchQueriesSince: async () => [],
      fetchSummary: async () => ({
        type: "summary" as const, totalQueries: 0, blockedQueries: 0, percentBlocked: 0, activeClients: 0,
      }),
      fetchTopClients: async () => ({ type: "clients" as const, generatedAt: 1, clients: [] }),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      topClientsEveryNPolls: 1,
      onEvent: (e) => events.push(e.type),
      nowSeconds: () => 1000,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    expect(events).toContain("clients");
  });

  it("does not create a second poll loop when restarted while a poll is in flight", async () => {
    let resolveFirst!: (value: QueryEvent[]) => void;
    const firstPoll = new Promise<QueryEvent[]>((resolve) => {
      resolveFirst = resolve;
    });
    const client = {
      fetchQueriesSince: vi
        .fn()
        .mockReturnValueOnce(firstPoll)
        .mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      onEvent: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // erster Poll hängt am offenen Promise
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(1);

    poller.stop();
    poller.start(); // Neustart, während der alte Poll noch in flight ist
    await vi.advanceTimersByTimeAsync(0); // erster Poll der neuen Schleife
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(2);

    resolveFirst([]); // alter Poll endet jetzt — darf NICHT weiterplanen
    await vi.advanceTimersByTimeAsync(0);

    // Drei weitere Intervalle: nur die neue Schleife darf pollen (2 + 3 = 5)
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(5);
    poller.stop();
  });
});
