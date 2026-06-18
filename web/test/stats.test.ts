import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import { applyQuery, emptyGraph, type GraphState } from "../src/lib/graph/store.js";
import { clusterView } from "../src/lib/graph/cluster.js";
import { nodeDetails } from "../src/lib/detail/stats.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return { type: "query", id: Math.floor(Math.random() * 1e9), time: 0, domain, clientIp: "10.0.0.1", clientName: "pc", blocked: false, status: "FORWARDED", ...opts };
}
function build(qs: QueryEvent[]): GraphState {
  let g = emptyGraph();
  let t = 1000;
  for (const query of qs) g = applyQuery(g, query, (t += 1000));
  return g;
}

describe("nodeDetails", () => {
  it("summarises a client: top domains, totals, blocked", () => {
    const g = build([q("a.com"), q("a.com"), q("ads.com", { blocked: true }), q("b.com")]);
    const d = nodeDetails(g, "client:10.0.0.1");
    expect(d?.kind).toBe("client");
    if (d?.kind !== "client") throw new Error("expected client");
    expect(d.label).toBe("pc");
    expect(d.totalQueries).toBe(4);
    expect(d.blockedQueries).toBe(1);
    expect(d.topDomains[0]).toMatchObject({ domain: "a.com", hits: 2 });
    expect(d.topDomains.length).toBeLessThanOrEqual(6);
  });

  it("summarises a domain: querying clients, blocked + status", () => {
    let g = build([q("ads.com", { blocked: true, status: "GRAVITY" })]);
    g = applyQuery(g, q("ads.com", { clientIp: "10.0.0.2", clientName: "tv", blocked: true, status: "GRAVITY" }), 9000);
    const d = nodeDetails(g, "domain:ads.com");
    expect(d?.kind).toBe("domain");
    if (d?.kind !== "domain") throw new Error("expected domain");
    expect(d.blocked).toBe(true);
    expect(d.status).toBe("GRAVITY");
    expect(d.clients.map((c) => c.client).sort()).toEqual(["pc", "tv"]);
  });

  it("summarises a cluster group super-node", () => {
    const base = build([q("api.spotify.com"), q("accounts.spotify.com", { clientIp: "10.0.0.2", clientName: "tv" })]);
    const view = clusterView(base, new Set());
    const d = nodeDetails(view, "group:spotify.com");
    expect(d?.kind).toBe("domain");
    if (d?.kind !== "domain") throw new Error("expected domain");
    expect(d.groupSize).toBe(2);
    expect(d.totalQueries).toBe(2);
    expect(d.clients.map((c) => c.client).sort()).toEqual(["pc", "tv"]);
  });

  it("returns null for an unknown id", () => {
    expect(nodeDetails(emptyGraph(), "client:nope")).toBeNull();
  });
});
