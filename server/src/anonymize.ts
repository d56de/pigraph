import type { ServerEvent } from "@pihole-viz/shared";

export interface Anonymizer {
  /** Gast-Sicht: ersetzt Identitäten durch stabile Pseudonyme; clients-Events → null (unterdrückt). */
  anonymizeEvent(event: ServerEvent): ServerEvent | null;
}

export function createAnonymizer(): Anonymizer {
  const clients = new Map<string, string>();
  const domains = new Map<string, string>();

  const label = (map: Map<string, string>, key: string, make: (n: number) => string): string => {
    const hit = map.get(key);
    if (hit) return hit;
    const value = make(map.size + 1);
    map.set(key, value);
    return value;
  };

  return {
    anonymizeEvent(event) {
      switch (event.type) {
        case "query": {
          const who = label(clients, event.clientIp, (n) => `Client ${n}`);
          return {
            ...event,
            clientIp: who,
            clientName: who,
            domain: label(domains, event.domain, (n) => `site-${n}`),
          };
        }
        case "clients":
          return null; // identitätslastig → unterdrücken
        default:
          return event; // summary, status: Aggregat/Zustand, unkritisch
      }
    },
  };
}
