# Client-Insights — Design (v1)

Date: 2026-06-13
Status: Approved (brainstorming)

## Overview

Add a **client overview** to the dashboard: clicking the top-left HUD
`Clients: NN` metric expands a panel below it, showing per-client information
across two tabs — **Aktiv** (live, derived from the graph) and **Alle 24h**
(from Pi-hole). This complements the existing per-client DetailCard (opened by
clicking a client *node*), which stays unchanged.

Tailscale enrichment (tailnet name/IP per client) is explicitly **out of scope**
for v1 and tracked as a separate follow-up spec.

## Goals

- Clicking the HUD `Clients` metric reveals a client list without leaving the graph.
- Two tiers: instant live clients (graph) + complete 24h list (Pi-hole), matching the count.
- Per-client: hostname, IP, query count, % blocked, "active now" indicator.
- Clicking a client row highlights its node in the graph (when present).
- Fully theme-aware.

## Non-Goals (v1)

- Tailscale tailnet name/IP mapping (separate spec).
- Per-client history charts.
- Search / filter field (revisit only when lists get long).
- Changing the existing client-node DetailCard.

## Architecture

Two data sources feed one panel:

| Tab | Source | Server work |
|-----|--------|-------------|
| **Aktiv** | existing graph store (client nodes + edges) | none |
| **Alle 24h** | new Pi-hole `top_clients` endpoint | new fetch + event |

### New / changed units

- **`shared/src/events.ts`** — add `ClientsEventSchema`:
  ```
  type: "clients"
  generatedAt: number            // epoch seconds
  clients: Array<{ ip: string; name: string; total: number; blocked: number }>
  ```
  Add it to `ServerEventSchema` discriminated union.

- **`server/src/pihole-client.ts`** — `fetchTopClients(count = 50): Promise<ClientsEvent>`.
  Calls Pi-hole v6 `GET /api/stats/top_clients?count=N` for totals and
  `?count=N&blocked=true` for blocked counts, merges by `ip` (name falls back to ip).
  Reuses the existing `request()` (SID auth + 401 re-auth). **Exact response field
  names to be confirmed against the Pi-hole v6 API during the plan phase.**

- **`server/src/poller.ts`** — fetch `top_clients` on its own ~30 s cadence
  (24h aggregates change slowly; not every 2 s query poll) and broadcast a
  `clients` event. Failures are logged and skipped (do not break the query stream).

- **`web/src/lib/clients/clients-store.ts`** — writable holding the latest 24h
  list; updated from the `clients` event in the stream handler.

- **`web/src/lib/clients/clients-panel-store.ts`** — `writable<boolean>` open/closed.

- **`web/src/lib/clients/active-clients.ts`** — pure `activeClients(state: GraphState)`
  deriving the Aktiv-tab rows from graph client nodes + edges
  (`{ ip, name, total, blocked, activeNow }`), reusing the blocked-from-edges logic
  already in `detail/stats.ts`.

- **`web/src/lib/clients/ClientsPanel.svelte`** — the expandable panel (tabs, list,
  row click). Positioned top-left, directly below the HUD metrics, same panel styling.

- **`web/src/lib/hud/Hud.svelte`** — the `Clients` metric becomes a toggle button
  (adds a `▾` affordance) that flips `clients-panel-store`.

### Data flow

```
Pi-hole ──/api/stats/top_clients──▶ poller (~30s) ──clients event──▶ broadcaster ──SSE──▶
  stream.ts ──▶ clients-store ──▶ ClientsPanel (Alle 24h tab)

graph store ──▶ active-clients(state) ──▶ ClientsPanel (Aktiv tab)
HUD Clients metric ──toggle──▶ clients-panel-store ──▶ ClientsPanel (open/closed)
ClientsPanel row click ──▶ selection-store (existing highlight) ──▶ renderer + DetailCard
```

## UI & Behaviour

- **Trigger:** click `Clients NN` (top-left). Re-click / click outside / `Esc` closes.
- **Tabs:** `Aktiv` (default) | `Alle 24h`.
- **Row:** `● hostname … queries … %blocked`.
  - Status dot: **filled** = active now (query within the live decay window);
    **hollow** = known but currently quiet.
  - IP shown as a dim secondary detail.
  - Sorted by query count, descending.
- **Aktiv tab:** every current graph client; live hits + % blocked (from edges).
- **Alle 24h tab:** Pi-hole list (length ≈ the NN count); total / blocked / rate;
  status dot set by cross-referencing the live graph.
- **Row click:** highlight the client's node via the existing selection/highlight
  mechanism and open its DetailCard. In the 24h tab, a client without a live node
  shows stats only (no highlight).
- **Theming:** uses existing CSS vars (`--panel`, `--panel-border`, `--text`,
  `--text-dim`, `--blocked`).

## Edge cases

- Empty client list → panel shows a muted "keine Clients" line.
- Client without a name → display the IP as the name.
- Many clients → `count=50` cap from Pi-hole + internal scroll in the panel.
- `clients` event not yet received → Alle-24h tab shows a "lädt…" placeholder;
  Aktiv tab works immediately from the graph.
- Theme change while open → panel re-colours via CSS vars (no JS needed).

## Testing

Follow the repo convention: test pure logic, keep components thin.

- `shared`: `ClientsEventSchema` parse + validation (valid, missing fields, empty list).
- `server`: `fetchTopClients` with a mock fetch — total+blocked merge by ip,
  name fallback to ip, SID reuse / 401 re-auth path.
- `web`: `clients-store` event application (replace list, empty list).
- `web`: `activeClients(state)` pure derivation — totals, blocked, `activeNow` flag,
  sorting.

## Rollout

Ships through the existing snapshot deploy to the Pi (see `deploy-pipeline`
project memory). No env/config changes; `top_clients` uses the same Pi-hole
session as the existing endpoints.
