import { describe, expect, it } from "vitest";
import { activeClients } from "../src/lib/clients/active-clients.js";
import type { GraphState } from "../src/lib/graph/store.js";

function state(): GraphState {
  return {
    nodes: new Map([
      ["client:10.0.0.1", { id: "client:10.0.0.1", kind: "client", label: "iphone", blocked: false, hits: 10, lastSeen: 1000 }],
      ["client:10.0.0.2", { id: "client:10.0.0.2", kind: "client", label: "nas", blocked: false, hits: 3, lastSeen: 0 }],
      ["domain:a.com", { id: "domain:a.com", kind: "domain", label: "a.com", blocked: false, hits: 7, lastSeen: 1000 }],
      ["domain:ad.com", { id: "domain:ad.com", kind: "domain", label: "ad.com", blocked: true, hits: 6, lastSeen: 1000 }],
    ]),
    edges: new Map([
      ["client:10.0.0.1->domain:a.com", { source: "client:10.0.0.1", target: "domain:a.com", hits: 7, lastSeen: 1000, blocked: false }],
      ["client:10.0.0.1->domain:ad.com", { source: "client:10.0.0.1", target: "domain:ad.com", hits: 3, lastSeen: 1000, blocked: true }],
      ["client:10.0.0.2->domain:a.com", { source: "client:10.0.0.2", target: "domain:a.com", hits: 3, lastSeen: 0, blocked: false }],
    ]),
  } as unknown as GraphState;
}

describe("activeClients", () => {
  it("derives totals, blocked, and activeNow, sorted by total desc", () => {
    const rows = activeClients(state(), 2000);
    expect(rows.map((r) => r.ip)).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(rows[0]).toMatchObject({ name: "iphone", total: 10, blocked: 3, activeNow: true });
    expect(rows[1]).toMatchObject({ name: "nas", total: 3, blocked: 0 });
  });

  it("marks a client idle once its lastSeen is outside the window", () => {
    const rows = activeClients(state(), 10_000);
    expect(rows.find((r) => r.ip === "10.0.0.1")?.activeNow).toBe(false);
  });

  it("exposes per-client forwarded and sorts by it desc", () => {
    const state = {
      nodes: new Map([
        ["client:10.0.0.1", { id: "client:10.0.0.1", kind: "client", label: "a", blocked: false, hits: 50, lastSeen: 1000, forwarded: 3 }],
        ["client:10.0.0.2", { id: "client:10.0.0.2", kind: "client", label: "b", blocked: false, hits: 5, lastSeen: 1000, forwarded: 20 }],
        ["client:10.0.0.3", { id: "client:10.0.0.3", kind: "client", label: "c", blocked: false, hits: 9, lastSeen: 1000 }],
      ]),
      edges: new Map(),
    } as unknown as GraphState;

    const rows = activeClients(state, 1000);
    expect(rows.map((r) => r.ip)).toEqual(["10.0.0.2", "10.0.0.1", "10.0.0.3"]);
    expect(rows.map((r) => r.forwarded)).toEqual([20, 3, 0]);
  });
});
