import { writable } from "svelte/store";
import type { ClientStat } from "@pihole-viz/shared";

/** Letzte 24h-Client-Liste aus dem `clients`-Event. */
export const clients24h = writable<ClientStat[]>([]);

export function setClients(list: ClientStat[]): void {
  clients24h.set(list);
}
