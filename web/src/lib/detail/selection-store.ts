import { writable } from "svelte/store";

/** id des aktuell gewählten Knotens (client:/domain:/group:) oder null. */
export const selectedId = writable<string | null>(null);

export function selectNode(id: string): void {
  selectedId.set(id);
}

export function clearSelection(): void {
  selectedId.set(null);
}
