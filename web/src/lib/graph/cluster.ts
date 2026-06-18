import { getDomain } from "tldts";
import type { GraphEdge, GraphNode, GraphState } from "./store.js";

/**
 * Pure view transform: groups domain nodes by registrable domain (eTLD+1).
 * Groups with ≥2 subdomains collapse into a super-node `group:<registrable>`;
 * if the registrable is in `expanded`, the anchor PLUS subdomains stay (mini-hub).
 * Clients always connect to the group anchor (aggregated edge).
 */
export function clusterView(state: GraphState, expanded: ReadonlySet<string>): GraphState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  // Group domain nodes by registrable domain
  const groups = new Map<string, GraphNode[]>();
  for (const node of state.nodes.values()) {
    if (node.kind === "client") {
      nodes.set(node.id, node);
      continue;
    }
    // .arpa (Reverse-DNS/PTR) hat keine sinnvolle registrierbare Domain —
    // tldts liefert hier z.B. "127.in-addr.arpa", was distincte PTRs fälschlich
    // zusammenwürfe. Daher als eigenen Knoten behalten.
    const reg = node.label.endsWith(".arpa") ? node.label : (getDomain(node.label) ?? node.label);
    const arr = groups.get(reg) ?? [];
    arr.push(node);
    groups.set(reg, arr);
  }

  // Map from original domain node id → target node id in the view
  const targetOf = new Map<string, string>();

  for (const [reg, members] of groups) {
    if (members.length === 1) {
      const only = members[0];
      nodes.set(only.id, only);
      targetOf.set(only.id, only.id);
      continue;
    }

    const groupId = `group:${reg}`;
    const blockedMember = members.find((m) => m.blocked);
    const anchor: GraphNode = {
      id: groupId,
      kind: "domain",
      label: reg,
      blocked: blockedMember !== undefined,
      hits: members.reduce((s, m) => s + m.hits, 0),
      lastSeen: Math.max(...members.map((m) => m.lastSeen)),
      opacity: Math.max(...members.map((m) => m.opacity)),
      // status vom ersten geblockten Member, sonst vom ersten Member (Map-Insertion-Order)
      status: (blockedMember ?? members[0]).status,
      groupSize: members.length,
    };
    nodes.set(groupId, anchor);
    for (const m of members) targetOf.set(m.id, groupId);

    if (expanded.has(reg)) {
      for (const m of members) {
        nodes.set(m.id, m);
        const eid = `${groupId}->${m.id}`;
        edges.set(eid, {
          id: eid,
          source: groupId,
          target: m.id,
          hits: m.hits,
          lastSeen: m.lastSeen,
          blocked: m.blocked,
        });
      }
    }
  }

  // Remap original edges to their group targets, aggregating where needed
  for (const edge of state.edges.values()) {
    const target = targetOf.get(edge.target) ?? edge.target;
    const eid = `${edge.source}->${target}`;
    const prev = edges.get(eid);
    if (prev) {
      edges.set(eid, {
        ...prev,
        hits: prev.hits + edge.hits,
        blocked: prev.blocked || edge.blocked,
        lastSeen: Math.max(prev.lastSeen, edge.lastSeen),
      });
    } else {
      edges.set(eid, {
        id: eid,
        source: edge.source,
        target,
        hits: edge.hits,
        lastSeen: edge.lastSeen,
        blocked: edge.blocked,
      });
    }
  }

  return { nodes, edges, droppedDomains: state.droppedDomains };
}
