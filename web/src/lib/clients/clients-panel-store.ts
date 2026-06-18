import { writable } from "svelte/store";

/** Ist das Client-Panel unter dem HUD aufgeklappt? */
export const clientsPanelOpen = writable(false);

export function toggleClientsPanel(): void {
  clientsPanelOpen.update((v) => !v);
}
export function closeClientsPanel(): void {
  clientsPanelOpen.set(false);
}
