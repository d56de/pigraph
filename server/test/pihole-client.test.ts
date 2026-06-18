import { describe, expect, it, vi } from "vitest";
import { PiholeClient } from "../src/pihole-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const AUTH_OK = { session: { valid: true, sid: "sid-1" } };

const QUERIES = {
  queries: [
    {
      id: 1,
      time: 1000.2,
      domain: "ads.example.com",
      status: "GRAVITY",
      client: { ip: "192.168.1.10", name: "iphone" },
    },
    {
      id: 2,
      time: 1001.0,
      domain: "api.spotify.com",
      status: "FORWARDED",
      client: { ip: "192.168.1.11", name: null },
    },
  ],
};

describe("PiholeClient", () => {
  it("authenticates once and maps queries to events", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(jsonResponse(200, QUERIES));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    const events = await client.fetchQueriesSince(999);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://pi/api/auth",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "http://pi/api/queries?from=999&length=1000",
      expect.objectContaining({ headers: { "X-FTL-SID": "sid-1" } }),
    );
    expect(events).toEqual([
      {
        type: "query",
        id: 1,
        time: 1000.2,
        domain: "ads.example.com",
        clientIp: "192.168.1.10",
        clientName: "iphone",
        blocked: true,
        status: "GRAVITY",
      },
      {
        type: "query",
        id: 2,
        time: 1001.0,
        domain: "api.spotify.com",
        clientIp: "192.168.1.11",
        clientName: "192.168.1.11",
        blocked: false,
        status: "FORWARDED",
      },
    ]);
  });

  it("re-authenticates once on 401 and retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { session: { valid: true, sid: "old" } }))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { session: { valid: true, sid: "new" } }))
      .mockResolvedValueOnce(jsonResponse(200, { queries: [] }));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    const events = await client.fetchQueriesSince(0);

    expect(events).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/queries"),
      expect.objectContaining({ headers: { "X-FTL-SID": "new" } }),
    );
  });

  it("throws a clear error when auth fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const client = new PiholeClient("http://pi", "wrong", fetchFn);
    await expect(client.fetchQueriesSince(0)).rejects.toThrow(/Auth/);
  });

  it("throws with path and status on non-401 error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(jsonResponse(500, {}));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    const error: unknown = await client.fetchQueriesSince(0).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/api\/queries/);
    expect((error as Error).message).toMatch(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("logout sends DELETE with sid and clears it; no-op without sid", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(jsonResponse(200, { queries: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    await client.fetchQueriesSince(0);
    await client.logout();

    expect(fetchFn).toHaveBeenLastCalledWith(
      "http://pi/api/auth",
      expect.objectContaining({
        method: "DELETE",
        headers: { "X-FTL-SID": "sid-1" },
      }),
    );
    const callsAfterLogout = fetchFn.mock.calls.length;

    await client.logout();

    expect(fetchFn).toHaveBeenCalledTimes(callsAfterLogout);
  });

  it("maps the DNS record type to recordType", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          queries: [
            { id: 1, time: 1000, domain: "x.com", type: "AAAA", status: "FORWARDED", client: { ip: "1.2.3.4", name: "pc" } },
            { id: 2, time: 1001, domain: "lb._dns-sd._udp.fritz.box", type: "PTR", status: "FORWARDED", client: { ip: "1.2.3.4", name: "pc" } },
          ],
        }),
      );
    const client = new PiholeClient("http://pi", "pw", fetchFn);
    const events = await client.fetchQueriesSince(0);
    expect(events.map((e) => e.recordType)).toEqual(["AAAA", "PTR"]);
  });

  it("maps the summary endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          queries: { total: 24613, blocked: 4530, percent_blocked: 18.4 },
          clients: { active: 14, total: 20 },
        }),
      );
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    await expect(client.fetchSummary()).resolves.toEqual({
      type: "summary",
      totalQueries: 24613,
      blockedQueries: 4530,
      percentBlocked: 18.4,
      activeClients: 14,
      cached: 0,
      forwarded: 0,
    });
  });

  it("fetchTopClients merges total and blocked counts by ip", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.includes("/api/auth")) {
        return { ok: true, status: 200, json: async () => ({ session: { valid: true, sid: "s" } }) };
      }
      if (url.includes("blocked=true")) {
        return { ok: true, status: 200, json: async () => ({ clients: [{ ip: "10.0.0.1", name: "a", count: 5 }] }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ clients: [
          { ip: "10.0.0.1", name: "a", count: 50 },
          { ip: "10.0.0.2", name: "", count: 20 },
        ] }),
      };
    }) as unknown as typeof fetch;

    const client = new PiholeClient("http://pi", "pw", fetchFn);
    const event = await client.fetchTopClients(50);

    expect(event.type).toBe("clients");
    expect(event.clients).toEqual([
      { ip: "10.0.0.1", name: "a", total: 50, blocked: 5 },
      { ip: "10.0.0.2", name: "10.0.0.2", total: 20, blocked: 0 },
    ]);
    expect(calls.some((u) => u.includes("/api/stats/top_clients?count=50"))).toBe(true);
    expect(calls.some((u) => u.includes("blocked=true"))).toBe(true);
  });

  it("fetchSummary maps cached and forwarded", async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes("/api/auth")) {
        return { ok: true, status: 200, json: async () => ({ session: { valid: true, sid: "s" } }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          queries: { total: 100, blocked: 8, percent_blocked: 8, cached: 60, forwarded: 32 },
          clients: { active: 5 },
        }),
      };
    }) as unknown as typeof fetch;

    const client = new PiholeClient("http://pi", "pw", fetchFn);
    const summary = await client.fetchSummary();
    expect(summary.cached).toBe(60);
    expect(summary.forwarded).toBe(32);
  });

  it("strips the local DNS suffix from query client names", async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes("/api/auth")) {
        return { ok: true, status: 200, json: async () => ({ session: { valid: true, sid: "s" } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          queries: [
            { id: 1, time: 1, domain: "a.com", status: "OK", client: { ip: "192.168.1.135", name: "iPhone.fritz.box" } },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const client = new PiholeClient("http://pi", "pw", fetchFn);
    const events = await client.fetchQueriesSince(0);
    expect(events[0].clientName).toBe("iPhone");
  });
});
