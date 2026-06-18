import { writable } from "svelte/store";

const KEY = "pihole-viz-hide-ptr";

function initial(): boolean {
  if (typeof localStorage === "undefined") return true;
  const stored = localStorage.getItem(KEY);
  return stored === null ? true : stored === "true";
}

/** Whether PTR/Reverse-DNS queries are hidden (default: true). */
export const hidePtr = writable<boolean>(initial());

hidePtr.subscribe((v) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, String(v));
});
