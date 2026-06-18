import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.js";
import { PiholeClient } from "./pihole-client.js";
import { QueryPoller } from "./poller.js";
import { Broadcaster } from "./broadcaster.js";
import { createApp } from "./app.js";

const config = loadConfig(process.env);
const client = new PiholeClient(config.piholeUrl, config.piholePassword, fetch, config.clientNameSuffix);
const broadcaster = new Broadcaster();

const poller = new QueryPoller({
  client,
  pollIntervalMs: config.pollIntervalMs,
  summaryEveryNPolls: 5,
  // 24h-Client-Statistik ändert sich langsam → bei 2s-Poll ~alle 30s.
  topClientsEveryNPolls: 15,
  onEvent: (event) => broadcaster.broadcast(event),
});

let sessionSecret = config.sessionSecret;
if (config.dashboardPassword && !sessionSecret) {
  sessionSecret = randomBytes(32).toString("hex");
  console.warn(
    "[server] SESSION_SECRET nicht gesetzt — zufälliges generiert; Sessions überleben keinen Neustart. Für dauerhafte Logins SESSION_SECRET in server/.env setzen.",
  );
}
const app = createApp({
  broadcaster,
  fetchSummary: () => client.fetchSummary(),
  password: config.dashboardPassword,
  sessionSecret,
  guestMode: config.guestMode,
});
// Production: gebautes Frontend ausliefern (web/dist relativ zum Repo-Root)
const webDist = process.env.WEB_DIST ?? "../web/dist";
app.use("/*", serveStatic({ root: webDist }));

poller.start();
// Bewusst nur localhost — wer die Viz im LAN/Tailnet hosten will, ändert das hier.
const server = serve(
  { fetch: app.fetch, port: config.port, hostname: process.env.HOST ?? "127.0.0.1" },
  (info) => {
    console.log(`[server] läuft auf http://localhost:${info.port} → Pi-hole ${config.piholeUrl}`);
  },
);

async function shutdown(): Promise<void> {
  console.log("[server] fahre herunter…");
  poller.stop();
  await client.logout(); // Pi-hole hat begrenzte Session-Slots
  server.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
