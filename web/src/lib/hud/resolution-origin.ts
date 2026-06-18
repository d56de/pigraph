export type ResolutionOrigin = "blocked" | "cache" | "unbound" | "other";

const CACHE_STATUSES = new Set(["CACHE", "CACHE_STALE"]);
const FORWARDED_STATUSES = new Set(["FORWARDED", "FORWARD"]);

/** Woher kam die Antwort: blockiert / Cache / Unbound (forwarded) / sonstiges. */
export function resolutionOrigin(status: string, blocked: boolean): ResolutionOrigin {
  if (blocked) return "blocked";
  if (CACHE_STATUSES.has(status)) return "cache";
  if (FORWARDED_STATUSES.has(status)) return "unbound";
  return "other";
}
