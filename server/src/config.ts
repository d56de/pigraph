export interface Config {
  piholeUrl: string;
  piholePassword: string;
  pollIntervalMs: number;
  port: number;
  /** Lokales DNS-Suffix, das von Client-Namen abgeschnitten wird (z.B. "fritz.box"). Leer = nicht abschneiden. */
  clientNameSuffix: string;
  /** Login-Passwort fürs Dashboard. Leer = kein Schutz (offen). */
  dashboardPassword: string;
  /** Secret zum Signieren des Session-Cookies. Leer = beim Start zufällig (überlebt keinen Neustart). */
  sessionSecret: string;
  /** Gast-Modus (passwortloser, anonymisierter Read-Only-Blick). Nur wirksam mit dashboardPassword. */
  guestMode: boolean;
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} muss eine positive Ganzzahl sein, erhalten: "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const piholeUrl = env.PIHOLE_URL;
  if (!piholeUrl) {
    throw new Error("PIHOLE_URL fehlt — in server/.env setzen (siehe .env.example)");
  }
  const piholePassword = env.PIHOLE_PASSWORD;
  if (!piholePassword) {
    throw new Error("PIHOLE_PASSWORD fehlt — App-Passwort in server/.env setzen (siehe .env.example)");
  }
  return {
    piholeUrl: piholeUrl.replace(/\/+$/, ""),
    piholePassword,
    pollIntervalMs: parsePositiveInt(env.POLL_INTERVAL_MS, "POLL_INTERVAL_MS", 2000),
    port: parsePositiveInt(env.PORT, "PORT", 5641),
    clientNameSuffix: env.CLIENT_NAME_SUFFIX ?? "fritz.box",
    dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
    sessionSecret: env.SESSION_SECRET ?? "",
    guestMode: env.GUEST_MODE === "true",
  };
}
