import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import {
  MAX_DOMAINS,
  WINDOW_MS,
  applyQuery,
  emptyGraph,
  tick,
} from "../src/lib/graph/store.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return {
    type: "query",
    id: Math.floor(Math.random() * 1e9),
    time: 0,
    domain,
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: false,
    status: "FORWARDED",
    ...opts,
  };
}

describe("GraphStore", () => {
  it("creates client node, domain node and edge for a query", () => {
    const g = applyQuery(emptyGraph(), q("a.com"), 1000);
    expect(g.nodes.get("client:192.168.1.10")).toMatchObject({
      kind: "client",
      label: "iphone",
      hits: 1,
    });
    expect(g.nodes.get("domain:a.com")).toMatchObject({
      kind: "domain",
      label: "a.com",
      blocked: false,
      hits: 1,
      lastSeen: 1000,
    });
    expect(g.edges.get("client:192.168.1.10->domain:a.com")).toMatchObject({ hits: 1 });
  });

  it("does not mutate the previous state (immutability)", () => {
    const g1 = applyQuery(emptyGraph(), q("a.com"), 1000);
    const g2 = applyQuery(g1, q("a.com"), 2000);
    expect(g1.nodes.get("domain:a.com")!.hits).toBe(1);
    expect(g2.nodes.get("domain:a.com")!.hits).toBe(2);
    expect(g2.nodes.get("domain:a.com")!.lastSeen).toBe(2000);
  });

  it("marks a domain blocked when any query for it was blocked", () => {
    let g = applyQuery(emptyGraph(), q("ads.com"), 1000);
    g = applyQuery(g, q("ads.com", { blocked: true }), 2000);
    expect(g.nodes.get("domain:ads.com")!.blocked).toBe(true);
  });

  it("decays opacity linearly and removes expired domains", () => {
    let g = applyQuery(emptyGraph(), q("a.com"), 0);
    g = tick(g, WINDOW_MS / 2);
    expect(g.nodes.get("domain:a.com")!.opacity).toBeCloseTo(0.5, 1);
    g = tick(g, WINDOW_MS + 1000);
    expect(g.nodes.has("domain:a.com")).toBe(false);
    // Client ohne verbleibende Kanten verschwindet mit
    expect(g.nodes.has("client:192.168.1.10")).toBe(false);
    expect(g.edges.size).toBe(0);
  });

  it("keeps edge blocked once any query on it was blocked", () => {
    let g = applyQuery(emptyGraph(), q("ads.com", { blocked: true }), 1000);
    g = applyQuery(g, q("ads.com", { blocked: false }), 2000);
    expect(g.edges.get("client:192.168.1.10->domain:ads.com")!.blocked).toBe(true);
  });

  it("removes client when all its domains are evicted by cap", () => {
    let g = emptyGraph();
    // Client A: 10 alte Domains
    for (let i = 0; i < 10; i++) {
      g = applyQuery(g, q(`a${i}.com`, { clientIp: "10.0.0.1", clientName: "old-client" }), i);
    }
    // Client B: MAX_DOMAINS neuere Domains
    for (let i = 0; i < MAX_DOMAINS; i++) {
      g = applyQuery(g, q(`b${i}.com`, { clientIp: "10.0.0.2", clientName: "new-client" }), 10 + i);
    }
    g = tick(g, MAX_DOMAINS + 10);
    expect(g.droppedDomains).toBe(10);
    // Alle A-Domains evicted -> Client A verschwindet, B bleibt
    expect(g.nodes.has("client:10.0.0.1")).toBe(false);
    expect(g.nodes.has("client:10.0.0.2")).toBe(true);
  });

  it("records the latest status on a domain node", () => {
    const g = applyQuery(emptyGraph(), q("ads.com", { status: "GRAVITY", blocked: true }), 1000);
    expect(g.nodes.get("domain:ads.com")!.status).toBe("GRAVITY");
  });

  it("evicts oldest domains above MAX_DOMAINS and reports the drop count", () => {
    let g = emptyGraph();
    for (let i = 0; i < MAX_DOMAINS + 10; i++) {
      g = applyQuery(g, q(`d${i}.com`), i);
    }
    g = tick(g, MAX_DOMAINS + 10);
    const domainCount = [...g.nodes.values()].filter((n) => n.kind === "domain").length;
    expect(domainCount).toBe(MAX_DOMAINS);
    expect(g.nodes.has("domain:d0.com")).toBe(false); // ältester flog raus
    expect(g.nodes.has(`domain:d${MAX_DOMAINS + 9}.com`)).toBe(true);
    expect(g.droppedDomains).toBe(10);
  });
});

describe("per-client forwarded (Unbound) count", () => {
  function clientNode(g: ReturnType<typeof emptyGraph>) {
    return [...g.nodes.values()].find((n) => n.kind === "client");
  }

  it("counts only forwarded (Unbound) queries", () => {
    let g = applyQuery(emptyGraph(), q("a.com", { status: "FORWARDED", blocked: false }), 1000);
    g = applyQuery(g, q("b.com", { status: "CACHE", blocked: false }), 1000);
    g = applyQuery(g, q("ad.com", { status: "GRAVITY", blocked: true }), 1000);
    expect(clientNode(g)?.forwarded).toBe(1);
  });

  it("does not count a forwarded-but-blocked query", () => {
    const g = applyQuery(emptyGraph(), q("x.com", { status: "FORWARDED", blocked: true }), 1000);
    expect(clientNode(g)?.forwarded).toBe(0);
  });

  it("keeps forwarded across a decay tick", () => {
    let g = applyQuery(emptyGraph(), q("a.com", { status: "FORWARDED", blocked: false }), 1000);
    g = tick(g, 1000);
    expect(clientNode(g)?.forwarded).toBe(1);
  });
});
