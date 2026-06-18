import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@pihole-viz/shared";
import { createAnonymizer } from "../src/anonymize.js";

const query = (over: Partial<Record<string, unknown>> = {}): ServerEvent =>
  ({
    type: "query", id: 1, time: 1000, domain: "ads.example.com",
    clientIp: "192.168.1.5", clientName: "laptop", blocked: false, status: "FORWARDED",
    ...over,
  }) as ServerEvent;

describe("createAnonymizer", () => {
  it("replaces client + domain in a query, keeps status/blocked", () => {
    const a = createAnonymizer();
    const out = a.anonymizeEvent(query());
    expect(out).toMatchObject({ type: "query", status: "FORWARDED", blocked: false });
    expect(out && "clientName" in out && out.clientName).toBe("Client 1");
    expect(out && "clientIp" in out && out.clientIp).toBe("Client 1");
    expect(out && "domain" in out && out.domain).toBe("site-1");
  });

  it("is stable: same real values → same pseudonyms", () => {
    const a = createAnonymizer();
    a.anonymizeEvent(query());
    const a2 = a.anonymizeEvent(query({ id: 2 }));
    expect(a2).toMatchObject({ domain: "site-1", clientName: "Client 1" });
  });

  it("gives different reals different pseudonyms", () => {
    const a = createAnonymizer();
    a.anonymizeEvent(query());
    const a2 = a.anonymizeEvent(query({ clientIp: "10.0.0.9", domain: "cdn.test.net" }));
    expect(a2).toMatchObject({ clientName: "Client 2", domain: "site-2" });
  });

  it("suppresses clients events (returns null)", () => {
    const a = createAnonymizer();
    expect(a.anonymizeEvent({ type: "clients", generatedAt: 1, clients: [] })).toBeNull();
  });

  it("passes summary and status through unchanged", () => {
    const a = createAnonymizer();
    const summary: ServerEvent = { type: "summary", totalQueries: 5, blockedQueries: 1, percentBlocked: 20, activeClients: 2 };
    const status: ServerEvent = { type: "status", state: "online" };
    expect(a.anonymizeEvent(summary)).toEqual(summary);
    expect(a.anonymizeEvent(status)).toEqual(status);
  });
});
