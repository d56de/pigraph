# pihole-viz — Verbesserungen: Clustering, Detail-Karte, Theming, Docker

**Datum:** 2026-06-12
**Status:** Approved (Brainstorming abgeschlossen)
**Baut auf:** [2026-06-10-pihole-viz-design.md](./2026-06-10-pihole-viz-design.md)

## Ziel

Vier unabhängige Verbesserungen am bestehenden pihole-viz, in einer Spec,
sequenziell gebaut: (1) Domain-Clustering nach registrierbarer Domain,
(2) Detail-Karte beim Klick, (3) Theme-Umschalter, (4) Docker-Hosting auf
dem Raspi.

## Architektur-Grundidee

Der bestehende `GraphStore` (web/src/lib/graph/store.ts) bleibt **unverändert** —
er hält weiter die rohen Query-abgeleiteten Knoten/Kanten. Clustering wird eine
**reine Transform-Schicht** dazwischen:

```
SSE → GraphStore (roh, immutable) → cluster-transform (view) → GraphRenderer
                                          ↑ expandedGroups
DetailCard ← stats(GraphState, id) ← selection-store
Theme-Store → CSS-Variablen (HUD/Karten) + renderer.setTheme(palette)
```

So bleibt die Kernlogik testbar, und der Renderer zeigt nur, was die Transform
liefert.

## Entscheidungen (aus dem Brainstorming)

| Frage | Entscheidung |
|---|---|
| Theming | **Paletten-Umschalter**, Themes **Obsidian / Aurora / Nord**, Wahl in `localStorage` gemerkt |
| Cluster-Regel | **Registrierbare Domain (eTLD+1)**, automatisch via `tldts` |
| Cluster-Darstellung | **Eingeklappte Super-Knoten** mit Anzahl-Badge; Klick klappt im Graph auf (Mini-Hub) + Detail-Karte; erneuter Klick klappt ein |
| Detail-Panel | **Schwebende Karte** am Knoten, kippt am Rand |
| Docker | **Privates GitHub-Remote**, Pi klont & `docker compose up -d --build` |
| Reihenfolge | 1) Clustering → 2) Detail-Karte → 3) Theming → 4) Docker |

---

## 1. Domain-Clustering (eTLD+1, einklappbar)

### Modul `web/src/lib/graph/cluster.ts` (pure)

`clusterView(state: GraphState, expanded: ReadonlySet<string>): GraphState`

- Gruppiert Domain-Knoten nach registrierbarer Domain via `tldts.getDomain(domain)`
  (Fallback: ganze Domain, falls `getDomain` null liefert, z.B. bei IP/PTR).
- Eine Gruppe mit **≥2** Subdomains, die **nicht** in `expanded` ist → ein
  **Super-Knoten** mit `id = "group:<registrable>"`, `kind: "domain"`,
  `label = "<registrable>"`, aggregiert: `hits` = Σ Subdomain-hits,
  `blocked` = OR über Subdomains, plus `groupSize` (Anzahl Subdomains).
  Client→Subdomain-Kanten werden zu Client→Gruppe-Kanten aggregiert
  (hits summiert, blocked OR), `lastSeen`/`opacity` = Max der Subdomains.
- Eine Gruppe mit **1** Subdomain → unveränderter Domain-Knoten (kein Clustern
  für Einzelgänger).
- Eine Gruppe **in** `expanded` → Gruppen-Anker-Knoten `group:<registrable>`
  (klein, als Handle) **plus** alle Subdomain-Knoten; Kanten:
  Client→Gruppe (aggregiert, bleibt als Verbindung) **und** Gruppe→Subdomain
  je Subdomain. So entsteht der Mini-Hub.
- Ergebnis ist wieder ein `GraphState` (gleiche Typen), den der Renderer/die
  Simulation unverändert konsumieren.

### Typ-Erweiterung

`GraphNode` bekommt optionales `groupSize?: number` (nur bei Super-Knoten gesetzt).
Bestehende Felder unverändert. Der Renderer zeichnet bei `groupSize` ein
Anzahl-Badge (kleiner `Text` mittig auf dem Knoten).

### Verdrahtung

- `App.svelte` hält `let expandedGroups = new Set<string>()` (reaktiv) und
  berechnet vor jedem `renderer.update()` den View-Graph:
  `renderer.update(clusterView(graph, expandedGroups))`.
- Klick auf einen Super-Knoten (id beginnt mit `group:`) → toggelt die
  registrierbare Domain in `expandedGroups`.

### Tests (`web/test/cluster.test.ts`)

- 2 Subdomains gleicher registrierbarer Domain → 1 Super-Knoten mit `groupSize=2`,
  aggregierten hits, einer Client→Gruppe-Kante.
- Einzelne Domain → unverändert (kein Super-Knoten).
- `blocked` aggregiert per OR (eine geblockte Subdomain → Gruppe blocked).
- Gruppe in `expanded` → Anker + Subdomains + Gruppe→Subdomain-Kanten.
- PTR/IP-Domain ohne registrierbare Domain → bleibt eigener Knoten.

## 2. Detail-Karte (schwebend am Knoten)

### Module

- `web/src/lib/detail/selection-store.ts`: `writable<string | null>` (selektierte
  Knoten-id), `select(id)`, `clearSelection()`.
- `web/src/lib/detail/stats.ts` (pure): `nodeDetails(state: GraphState, id: string): NodeDetails`
  - Client: Top-Domains (eigene Kanten nach hits sortiert, Top 6), Σ Queries,
    Σ geblockt + Rate, `lastSeen`.
  - Domain/Super-Knoten: welche Clients (reverse Kanten nach hits, Top 6),
    `blocked` + `status` (Block-Grund), Σ Queries; bei Super-Knoten zusätzlich
    `groupSize`.
  - Liefert ein diskriminiertes Objekt `{ kind: "client" | "domain", ... }`.
- `web/src/lib/detail/DetailCard.svelte`: rendert `NodeDetails`; Position folgt
  der Live-Bildschirmposition des Knotens.

### Live-Positionierung

`GraphRenderer` bekommt `screenPosition(id): {x, y} | null` (Welt-Position des
Knotens durch die Welt-Transform in Bildschirmkoordinaten). `DetailCard` liest
diese pro Frame (Pixi-Ticker-Callback oder `requestAnimationFrame`-Schleife in
`onMount`) und setzt `left/top`. Nahe dem rechten Rand kippt die Karte nach
links (Anker-Seite wechselt).

### Klick-Modell (final)

- **Client** → Karte + Subgraph-Highlight (bestehendes `setHighlight`).
- **Super-Knoten (`group:`)** → `expandedGroups` toggeln **und** Karte (Gruppen-
  Übersicht).
- **Einzelne Domain** → Karte.
- **Ziehen mit Bewegung** → pinnen (bestehend, unverändert; kein Karten-/Klick-
  Trigger, da `pointertap` bei Bewegung nicht feuert).
- **Klick ins Leere** (Stage-Hintergrund) → `clearSelection()` + Highlight weg.

Der Renderer ruft `onTap(id)` wie bisher; `App.svelte` entscheidet anhand der id
(Präfix `client:`/`domain:`/`group:`), was zu tun ist.

### Tests (`web/test/stats.test.ts`)

- Client mit 3 Domains → Top-Domains korrekt sortiert, Σ Queries/geblockt stimmen.
- Domain → beteiligte Clients korrekt, `blocked`/`status` durchgereicht.
- Super-Knoten → `groupSize` und Aggregat korrekt.

## 3. Theming (Paletten-Umschalter)

### Module

- `web/src/lib/theme/themes.ts`: `Palette`-Typ + Registry
  `THEMES: Record<ThemeId, Palette>` mit `obsidian | aurora | nord`. Jede Palette:
  `background, client, domainAllowed, domainBlocked, edge, edgeBlockedPulse,
  labelClient, labelDomain` (Graph) **und** `bg, panel, panelBorder, text,
  textDim, allowed, blocked, client` (HUD/CSS-Variablen). Das bisherige
  `colors.ts` wird die `obsidian`-Palette (Werte 1:1 übernommen).
- `web/src/lib/theme/theme-store.ts`: `writable<ThemeId>`, initial aus
  `localStorage` (Default `obsidian`), bei Änderung → `localStorage` schreiben.

### Anwendung

- Ein `applyTheme(id)`-Effekt (in `App.svelte`): setzt die CSS-Variablen
  (`--bg`, `--panel`, … aus app.css) per `document.documentElement.style.setProperty`
  und ruft `renderer.setTheme(palette)`.
- `GraphRenderer.setTheme(palette)`: speichert die aktive Palette, setzt
  `app.renderer.background`, und erzwingt Neu-Einfärben (Kerne über bestehende
  `drawCore`-Logik neu zeichnen, indem der gecachte `coreColor` invalidiert wird;
  Kanten/Labels lesen die aktive Palette im nächsten Frame). Der Renderer liest
  Farben künftig aus `this.palette` statt aus dem statischen `COLORS`-Import.
- Kleiner Umschalter **unten rechts neben dem Status** (`ThemeSwitcher.svelte`):
  drei Punkte/Kürzel, Klick wechselt durch oder kleines Menü.

### Aurora-Hinweis

Aurora-Knoten als **solide Farbe** (Cyan/Indigo-Mischton), kein Verlauf — hält
ein Theme als reinen Token-Tausch.

### Tests (`web/test/theme-store.test.ts`)

- Default `obsidian` ohne gespeicherten Wert.
- Gespeicherter Wert wird geladen.
- Wechsel schreibt `localStorage`.
- `THEMES` enthält alle drei IDs mit vollständigen Token-Sätzen.

## 4. Docker-Hosting

### Dateien (Repo-Root)

- `Dockerfile` (multi-stage):
  - Stage `build` (`node:22-alpine`): `npm ci`, `npm run build -w web`.
  - Stage `runtime` (`node:22-alpine`): kopiert `package*.json`, `shared/`,
    `server/`, gebautes `web/dist/`, dann `npm ci --omit=dev`; `CMD`
    `["npx","tsx","server/src/index.ts"]` — **ohne** `--env-file`.
  - **Kein Server-Code-Change nötig:** Docker liefert die Variablen über das
    Container-Environment (compose `env_file: .env`), und `loadConfig(process.env)`
    liest sie unverändert. Der bestehende `npm start` (mit `--env-file=.env`)
    bleibt für die lokale Entwicklung.
- `docker-compose.yml`: Service `pihole-viz`, `build: .`, `env_file: .env`,
  `ports: ["8089:5641"]`, `restart: unless-stopped`,
  Standard `PIHOLE_URL=http://pi.hole`.
- `.dockerignore` (node_modules, dist, .git, .superpowers, .env).

### Deployment

- Privates GitHub-Remote `d56de/pigraph` anlegen, `main` pushen.
- Auf dem Pi (host „docker"): `git clone`, `.env` aus `.env.example` mit dem
  App-Passwort befüllen, `docker compose up -d --build`.
- Updates: `git pull && docker compose up -d --build`.
- README bekommt einen Abschnitt **Deployment (Raspi/Docker)**.

### Verifikation

- `docker compose build` läuft lokal durch (Mac arm64 = Pi arm64).
- Container startet, `/api/summary` + `/events` antworten, Frontend lädt unter
  `http://<pi>:8089`.

## Nicht im Scope (bewusst)

- Schreibende Pi-hole-Aktionen (Domains blocken/freigeben) — separates Feature.
- CI/CD-Pipeline (nur Remote + manuelles `git pull` auf dem Pi).
- Firmen/Eigentümer-Clustering (verworfen zugunsten eTLD+1).
- Zeitfenster-Umschalter, Suche, Reverse-DNS-Filter — spätere Iterationen.

## Voraussetzungen

- Neue Frontend-Abhängigkeit: `tldts` (zero-dep, klein).
- GitHub-Zugang für das private Remote (via `gh`).
- Pi-hole erreichbar unter `http://pi.hole` vom Docker-Host aus.
