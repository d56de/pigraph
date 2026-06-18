import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pg_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage in Sekunden

/** Konstantzeit-Vergleich: beide Seiten auf 32 Byte hashen, dann timingSafeEqual. Leeres Soll-Passwort = nie ok. */
export function verifyPassword(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
