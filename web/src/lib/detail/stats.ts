import type { GraphState } from "../graph/store.js";

export interface DomainHit {
  domain: string;
  hits: number;
  blocked: boolean;
}
export interface ClientHit {
  client: string;
  hits: number;
}

export interface ClientDetails {
  kind: "client";
  id: string;
  label: string;
  ip: string;
  totalQueries: number;
  blockedQueries: number;
  topDomains: DomainHit[];
  lastSeen: number;
}

export interface DomainDetails {
  kind: "domain";
  id: string;
  label: string;
  blocked: boolean;
  status?: string;
  totalQueries: number;
  clients: ClientHit[];
  groupSize?: number;
  lastSeen: number;
}

export type NodeDetails = ClientDetails | DomainDetails;

const TOP_N = 6;

export function nodeDetails(state: GraphState, id: string): NodeDetails | null {
  const node = state.nodes.get(id);
  if (!node) return null;

  if (node.kind === "client") {
    const own = [...state.edges.values()].filter((e) => e.source === id);
    const topDomains: DomainHit[] = own
      .map((e) => ({ domain: state.nodes.get(e.target)?.label ?? e.target, hits: e.hits, blocked: e.blocked }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, TOP_N);
    return {
      kind: "client",
      id,
      label: node.label,
      ip: id.slice("client:".length),
      totalQueries: own.reduce((s, e) => s + e.hits, 0),
      blockedQueries: own.filter((e) => e.blocked).reduce((s, e) => s + e.hits, 0),
      topDomains,
      lastSeen: node.lastSeen,
    };
  }

  const incoming = [...state.edges.values()].filter((e) => e.target === id);
  const clients: ClientHit[] = incoming
    .map((e) => ({ client: state.nodes.get(e.source)?.label ?? e.source, hits: e.hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, TOP_N);
  return {
    kind: "domain",
    id,
    label: node.label,
    blocked: node.blocked,
    status: node.status,
    totalQueries: node.hits,
    clients,
    groupSize: node.groupSize,
    lastSeen: node.lastSeen,
  };
}
