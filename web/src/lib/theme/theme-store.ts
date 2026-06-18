import { writable } from "svelte/store";
import type { ThemeId } from "./themes.js";

const KEY = "pihole-viz-theme";
const VALID: ThemeId[] = ["obsidian", "aurora", "nord"];

function initial(): ThemeId {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return stored && (VALID as string[]).includes(stored) ? (stored as ThemeId) : "obsidian";
}

export const themeId = writable<ThemeId>(initial());

themeId.subscribe((id) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, id);
});
