import { writable } from "svelte/store";

/** Ist der Live-Feed auf Mobile aufgeklappt? Nicht persistiert (jedes Laden zu). */
export const feedOpen = writable(false);

export function toggleFeed(): void {
  feedOpen.update((v) => !v);
}
export function closeFeed(): void {
  feedOpen.set(false);
}
