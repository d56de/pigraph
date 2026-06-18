# pihole-viz — Obsidian-Style Live DNS Graph

**Datum:** 2026-06-10
**Status:** Approved (Brainstorming abgeschlossen)

## Ziel

Eine lokale Web-App, die den DNS-Verkehr eines Pi-hole v6 als lebendigen,
Obsidian-Graph-artigen Force-Graphen visualisiert: Clients und Domains als
leuchtende Knoten, Queries als Kanten, geblockte Domains rot. Dazu ein
dezentes Floating-HUD mit Kennzahlen und Live-Feed.

## Kontext & Rahmenbedingungen

- **Pi-hole:** v6, erreichbar über Tailscale auf `http://pi.hole`
  (Host „docker", Pi-hole läuft dort im Container). API liefert 401 ohne
  Auth — Authentifizierung über App-Passwort ist nötig.
- **Nutzung:** Browser auf dem Mac, bei Bedarf geöffnet. Kein Dauer-Display,
  kein Hosting auf dem Pi (bewusst verschoben, später möglich).
- **Ein Nutzer, ein Netz** — keine Mandantenfähigkeit, keine User-Accounts.

## Entscheidungen (aus dem Brainstorming)

| Frage | Entscheidung |
|---|---|
| Layout | **A — Floating HUD**: Graph fullscreen, Stats als halbtransparente Overlay-Panels |
| Graph-Modell | **Clients ↔ Domains** (bipartit), geblockte Domains rot |
| Zeitverhalten | **Gleitendes Fenster ~15 min** mit Aufpoppen, Pulsieren, Verblassen |
| Visual Style | **Obsidian Glow**: fast schwarzer Grund `#0b0d12`, weiche leuchtende Knoten, lila Clients, grün/rot Domains |
| Stack | **Vite + Svelte 5 + Pixi.js (WebGL) + d3-force**, Backend-Proxy mit Hono |

## Architektur

Monorepo `~/dev/pihole-viz` mit zwei Workspaces:

```
pihole-viz/
├── server/          # Hono-Backend (Node), kennt das Pi-hole-Passwort
│   ├── src/
│   │   ├── pihole-client.ts   # Auth (SID), Polling, Summary
│   │   ├── sse.ts             # SSE-Endpoint /events
│   │   └── index.ts           # HTTP-Server, statisches Hosting des Builds
│   └── .env                   # PIHOLE_URL, PIHOLE_PASSWORD (gitignored)
├── shared/          # geteilte Typen + zod-Schemas der SSE-Events
└── web/             # Vite + Svelte 5 Frontend
    └── src/
        ├── lib/graph/         # Sliding-Window-Store, Aggregation (pure TS)
        ├── lib/render/        # Pixi-Renderer, d3-force-Simulation, Glow
        └── lib/hud/           # HUD-Komponenten (Svelte)
```

### server/ — Backend-Proxy

- **Warum:** Das Pi-hole-App-Passwort darf nie in den Browser. CORS gegen
  die Pi-hole-API entfällt ebenfalls.
- **Auth:** `POST {PIHOLE_URL}/api/auth` mit Passwort → Session-ID (SID).
  SID wird im Speicher gehalten; bei `401` einmalig transparent erneuert.
- **Polling:** alle ~2 s `GET /api/queries?from=<cursor>` (Unix-Timestamp-
  Cursor auf der letzten gesehenen Query). Neue Queries → SSE-Broadcast.
- **Endpoints:**
  - `GET /events` — SSE-Stream: `query`-Events (domain, client, status,
    blocked, timestamp) und periodische `summary`-Events
  - `GET /api/summary` — aktuelle Kennzahlen (Queries heute, geblockt,
    Block-Rate, aktive Clients) von `/api/stats/summary`
  - statisches Serving von `web/dist` (Production); im Dev proxyt Vite
- **Konfiguration:** `.env` mit `PIHOLE_URL`, `PIHOLE_PASSWORD`,
  `POLL_INTERVAL_MS` (Default 2000), `PORT` (Default 5641).
  Fehlende Pflicht-Variablen → Abbruch beim Start mit klarer Meldung.

### web/ — Frontend

**Datenfluss:** SSE → `QueryStream` → `GraphStore` (Sliding Window) →
d3-force-Simulation → Pixi-Renderer. HUD liest denselben Store.

- **GraphStore (pure TypeScript, kein Rendering):**
  - Hält Knoten (Clients, Domains) und Kanten mit `lastSeen`, `hitCount`
  - Neue Query: Domain-/Client-Knoten upsert, Kante upsert, `lastSeen`
    aktualisieren — immutable Updates
  - Tick (1×/s): Knoten ohne Treffer verlieren Opacity (Decay über
    15 min); bei 0 werden Knoten/Kanten entfernt
  - Sicherheitsventil: max. 400 Domain-Knoten; darüber fliegen die
    ältesten zuerst raus (Anzeige im HUD: „zeige 400 von N")
- **Simulation:** d3-force (`forceManyBody`, `forceLink`, `forceCollide`,
  sanftes `forceCenter`). Läuft im Haupt-Thread; wenn das bei vielen
  Knoten ruckelt, Umzug in einen Web Worker (bewusst erst bei Bedarf).
- **Renderer (Pixi.js v8, WebGL):**
  - Knoten als Sprites mit radialem Glow (vorgerenderte Glow-Textur,
    getintet), Kanten als Linien mit niedriger Opacity
  - Neue Query: Knoten pulst kurz hell; geblockt → roter Puls auf Kante
  - Bloom dezent, Labels (Gerätenamen immer, Domains ab Zoomstufe/Hover)
  - Zoom/Pan (pixi-viewport), Hover-Tooltip, Klick auf Client dimmt
    alles außer dessen Subgraph
- **HUD (Svelte-Komponenten als Overlay):**
  - oben links: Queries heute / geblockt (Zähler)
  - oben rechts: Block-Rate als Ring-Gauge
  - unten links: Live-Feed der letzten ~8 Queries (rot + durchgestrichen
    = geblockt), neue Einträge sliden ein
  - unten rechts: Verbindungsstatus (verbunden / reconnecting / offline)

### Farben (Obsidian Glow)

| Element | Farbe |
|---|---|
| Hintergrund | `#0b0d12` |
| Client-Knoten | Lila `#a89df8`, Glow `#8b7cf8` |
| Domain erlaubt | Grün `#86efac` / `#4ade80` |
| Domain geblockt | Rot `#fca5a5` / `#f87171` |
| Kanten | `#2d3344`, aktiv heller |
| HUD-Panels | `#161a22` bei ~90 % Opacity, Border `#2a3040` |

## Fehlerbehandlung

- **Server:** 401 → SID-Refresh und Retry (1×); Pi-hole nicht erreichbar →
  Exponential Backoff beim Polling, SSE-Event `status: offline` an Clients;
  detailliertes Logging serverseitig.
- **Frontend:** `EventSource` reconnectet automatisch; HUD zeigt den
  Verbindungsstatus, der Graph friert ein statt zu crashen und decayt
  weiter. Eingehende SSE-Daten werden schema-validiert (zod), kaputte
  Events werden geloggt und verworfen.

## Tests (Vitest)

Fokus auf die pure Logik, Rendering nur als Smoke-Test:

1. **GraphStore:** Upsert-Verhalten, Decay/Entfernen nach Fenster,
   Node-Cap, Immutability
2. **Pi-hole-Client:** Auth-Flow, SID-Refresh bei 401, Cursor-Polling,
   Backoff (HTTP gemockt)
3. **SSE-Wire-Format:** Serialisierung/Parsing der Events (geteiltes
   Schema in `shared/`)
4. **Smoke:** App bootet, Canvas mountet, HUD rendert mit Mock-Stream

Ziel: hohe Abdeckung der Logik-Module; Pixi-Rendering wird nicht
pixelgenau getestet.

## Nicht im Scope (bewusst)

- Historische Ansichten / Tagesakkumulation (war Option, verworfen
  zugunsten des Live-Fensters)
- Hosting auf dem Pi, Kiosk-Modus
- Firmen-Clustering der Domains (evtl. späteres Feature)
- Schreibende Pi-hole-Aktionen (Domains blocken/freigeben)

## Einmalige Voraussetzung

App-Passwort im Pi-hole-Webinterface erzeugen
(Settings → Web Interface / API → „Configure app password") und in
`server/.env` als `PIHOLE_PASSWORD` hinterlegen.
