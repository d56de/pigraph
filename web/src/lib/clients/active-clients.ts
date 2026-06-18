import type { GraphState } from "../graph/store.js";

export interface ActiveClient {
  id: string;
  ip: string;
  name: string;
  total: number;
  blocked: number;
  forwarded: number;
  activeNow: boolean;
}

/** Eine Query gilt als "jetzt aktiv", wenn sie jünger als dieses Fenster ist. */
const ACTIVE_WINDOW_MS = 5000;

/** Live-Client-Zeilen aus dem aktuellen Graph-Zustand (Totals/Blocked aus Kanten). */
export function activeClients(state: GraphState, nowMs: number): ActiveClient[] {
  const totals = new Map<string, { total: number; blocked: number }>();
  for (const e of state.edges.values()) {
    const cur = totals.get(e.source) ?? { total: 0, blocked: 0 };
    cur.total += e.hits;
    if (e.blocked) cur.blocked += e.hits;
    totals.set(e.source, cur);
  }

  const rows: ActiveClient[] = [];
  for (const node of state.nodes.values()) {
    if (node.kind !== "client") continue;
    const t = totals.get(node.id) ?? { total: 0, blocked: 0 };
    rows.push({
      id: node.id,
      ip: node.id.slice("client:".length),
      name: node.label,
      total: t.total,
      blocked: t.blocked,
      forwarded: node.forwarded ?? 0,
      activeNow: nowMs - node.lastSeen < ACTIVE_WINDOW_MS,
    });
  }
  return rows.sort((a, b) => b.forwarded - a.forwarded || b.total - a.total);
}
