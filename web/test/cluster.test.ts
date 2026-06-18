import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import { applyQuery, emptyGraph, type GraphState } from "../src/lib/graph/store.js";
import { clusterView } from "../src/lib/graph/cluster.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return {
    type: "query",
    id: Math.floor(Math.random() * 1e9),
    time: 0,
    domain,
    clientIp: "10.0.0.1",
    clientName: "pc",
    blocked: false,
    status: "FORWARDED",
    ...opts,
  };
}

function build(domains: Array<[string, Partial<QueryEvent>?]>): GraphState {
  let g = emptyGraph();
  let t = 1000;
  for (const [d, opts] of domains) g = applyQuery(g, q(d, opts), (t += 1000));
  return g;
}

describe("clusterView", () => {
  const NONE = new Set<string>();

  it("collapses 2+ subdomains of the same registrable domain into one super-node", () => {
    const view = clusterView(build([["api.spotify.com"], ["accounts.spotify.com"]]), NONE);
    const group = view.nodes.get("group:spotify.com");
    expect(group).toMatchObject({ kind: "domain", label: "spotify.com", groupSize: 2, hits: 2 });
    expect(view.nodes.has("domain:api.spotify.com")).toBe(false);
    expect(view.edges.get("client:10.0.0.1->group:spotify.com")).toMatchObject({ hits: 2 });
  });

  it("leaves a single-subdomain registrable domain untouched", () => {
    const view = clusterView(build([["heise.de"]]), NONE);
    expect(view.nodes.has("domain:heise.de")).toBe(true);
    expect(view.nodes.has("group:heise.de")).toBe(false);
  });

  it("marks a group blocked when any subdomain was blocked", () => {
    const view = clusterView(
      build([["a.tiktok.com"], ["ads.tiktok.com", { blocked: true }]]),
      NONE,
    );
    expect(view.nodes.get("group:tiktok.com")!.blocked).toBe(true);
  });

  it("expands a group into anchor + subdomains with group->subdomain edges", () => {
    const view = clusterView(
      build([["api.spotify.com"], ["accounts.spotify.com"]]),
      new Set(["spotify.com"]),
    );
    expect(view.nodes.has("group:spotify.com")).toBe(true);
    expect(view.nodes.has("domain:api.spotify.com")).toBe(true);
    expect(view.nodes.has("domain:accounts.spotify.com")).toBe(true);
    expect(view.edges.get("group:spotify.com->domain:api.spotify.com")).toBeTruthy();
    expect(view.edges.get("client:10.0.0.1->group:spotify.com")).toBeTruthy();
    expect(view.edges.has("client:10.0.0.1->domain:api.spotify.com")).toBe(false);
  });

  it("keeps a domain without a registrable domain (PTR/arpa) as its own node", () => {
    const view = clusterView(build([["1.0.0.127.in-addr.arpa"]]), NONE);
    expect(view.nodes.has("domain:1.0.0.127.in-addr.arpa")).toBe(true);
    expect([...view.nodes.keys()].some((k) => k.startsWith("group:"))).toBe(false);
  });

  it("does not group distinct PTR records from the same subnet", () => {
    const view = clusterView(
      build([["1.0.168.192.in-addr.arpa"], ["2.0.168.192.in-addr.arpa"]]),
      NONE,
    );
    expect([...view.nodes.keys()].some((k) => k.startsWith("group:"))).toBe(false);
    expect(view.nodes.has("domain:1.0.168.192.in-addr.arpa")).toBe(true);
  });

  it("aggregates apex domain into its registrable group when a subdomain is also present", () => {
    const view = clusterView(build([["spotify.com"], ["api.spotify.com"]]), NONE);
    expect(view.nodes.get("group:spotify.com")).toMatchObject({ groupSize: 2, hits: 2 });
    expect(view.edges.get("client:10.0.0.1->group:spotify.com")?.hits).toBe(2);
  });
});
