import type { QueryEvent } from "@pihole-viz/shared";
import { resolutionOrigin } from "../hud/resolution-origin.js";

export const WINDOW_MS = 15 * 60_000;
export const MAX_DOMAINS = 400;

export interface GraphNode {
  id: string;
  kind: "client" | "domain";
  label: string;
  blocked: boolean;
  hits: number;
  lastSeen: number;
  opacity: number;
  /** Pi-hole-Status der letzten Query (nur Domain-Knoten), z.B. "GRAVITY". */
  status?: string;
  /** Anzahl Subdomains, wenn dies ein Cluster-Super-Knoten ist. */
  groupSize?: number;
  /** Anzahl Forwarded-Queries (Unbound), nur sinnvoll auf Client-Knoten. */
  forwarded?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  hits: number;
  lastSeen: number;
  blocked: boolean;
}

export interface GraphState {
  nodes: ReadonlyMap<string, GraphNode>;
  edges: ReadonlyMap<string, GraphEdge>;
  droppedDomains: number;
}

export function emptyGraph(): GraphState {
  return { nodes: new Map(), edges: new Map(), droppedDomains: 0 };
}

export function clientId(ip: string): string {
  return `client:${ip}`;
}

export function domainId(domain: string): string {
  return `domain:${domain}`;
}

export function applyQuery(state: GraphState, query: QueryEvent, now: number): GraphState {
  const cId = clientId(query.clientIp);
  const dId = domainId(query.domain);
  const eId = `${cId}->${dId}`;

  const nodes = new Map(state.nodes);
  const edges = new Map(state.edges);

  const client = nodes.get(cId);
  const isUnbound = resolutionOrigin(query.status, query.blocked) === "unbound";
  nodes.set(cId, {
    id: cId,
    kind: "client",
    label: query.clientName,
    blocked: false,
    hits: (client?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
    forwarded: (client?.forwarded ?? 0) + (isUnbound ? 1 : 0),
  });

  const domain = nodes.get(dId);
  nodes.set(dId, {
    id: dId,
    kind: "domain",
    label: query.domain,
    blocked: (domain?.blocked ?? false) || query.blocked,
    hits: (domain?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
    status: query.status,
  });

  const edge = edges.get(eId);
  edges.set(eId, {
    id: eId,
    source: cId,
    target: dId,
    hits: (edge?.hits ?? 0) + 1,
    lastSeen: now,
    blocked: (edge?.blocked ?? false) || query.blocked,
  });

  return { nodes, edges, droppedDomains: state.droppedDomains };
}

export function tick(state: GraphState, now: number): GraphState {
  const nodes = new Map<string, GraphNode>();
  let dropped = state.droppedDomains;

  // 1. Decay & Window: Domains verblassen, abgelaufene fliegen raus
  for (const node of state.nodes.values()) {
    const age = now - node.lastSeen;
    const opacity = Math.max(0, 1 - age / WINDOW_MS);
    if (node.kind === "domain" && opacity <= 0) continue;
    nodes.set(node.id, { ...node, opacity: node.kind === "client" ? 1 : opacity });
  }

  // 2. Cap: über MAX_DOMAINS hinaus älteste Domains entfernen
  const domains = [...nodes.values()]
    .filter((n) => n.kind === "domain")
    .sort((a, b) => a.lastSeen - b.lastSeen);
  if (domains.length > MAX_DOMAINS) {
    for (const evictee of domains.slice(0, domains.length - MAX_DOMAINS)) {
      nodes.delete(evictee.id);
      dropped += 1;
    }
  }

  // 3. Kanten ohne beide Endpunkte entfernen
  const edges = new Map<string, GraphEdge>();
  for (const edge of state.edges.values()) {
    if (nodes.has(edge.source) && nodes.has(edge.target)) edges.set(edge.id, edge);
  }

  // 4. Clients ohne Kanten entfernen
  const connected = new Set<string>();
  for (const edge of edges.values()) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  for (const node of nodes.values()) {
    if (node.kind === "client" && !connected.has(node.id)) nodes.delete(node.id);
  }

  return { nodes, edges, droppedDomains: dropped };
}
