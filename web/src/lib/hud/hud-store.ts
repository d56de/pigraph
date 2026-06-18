import { writable } from "svelte/store";
import type { ServerEvent } from "@pihole-viz/shared";
import { resolutionOrigin, type ResolutionOrigin } from "./resolution-origin.js";

// Gepufferte Live-Einträge: genug, um per Scroll auch ältere noch anzusehen.
export const FEED_LIMIT = 50;

export interface FeedItem {
  id: number;
  domain: string;
  clientName: string;
  blocked: boolean;
  origin: ResolutionOrigin;
}

export interface HudState {
  total: number;
  blocked: number;
  percent: number;
  clients: number;
  cached: number;
  forwarded: number;
  feed: FeedItem[];
  connected: boolean;
}

const initial: HudState = {
  total: 0,
  blocked: 0,
  percent: 0,
  clients: 0,
  cached: 0,
  forwarded: 0,
  feed: [],
  // Ehrlich pessimistisch: "verbunden" erst, wenn die SSE-Verbindung wirklich steht —
  // der Stream-Client meldet nur Transitionen, ein nie verbundener Start bliebe sonst grün.
  connected: false,
};

export const hud = writable<HudState>(initial);

export function resetHud(): void {
  hud.set(initial);
}

export function applyServerEvent(event: ServerEvent): void {
  hud.update((state) => {
    switch (event.type) {
      case "summary":
        return {
          ...state,
          total: event.totalQueries,
          blocked: event.blockedQueries,
          percent: event.percentBlocked,
          clients: event.activeClients,
          cached: event.cached ?? 0,
          forwarded: event.forwarded ?? 0,
        };
      case "query":
        return {
          ...state,
          feed: [
            {
              id: event.id,
              domain: event.domain,
              clientName: event.clientName,
              blocked: event.blocked,
              origin: resolutionOrigin(event.status, event.blocked),
            },
            ...state.feed,
          ].slice(0, FEED_LIMIT),
        };
      case "status":
        return { ...state, connected: event.state === "online" };
      case "clients":
        return state; // vom Client-Panel verarbeitet, kein HUD-Effekt
    }
  });
}
