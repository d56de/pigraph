# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and the
project aims to adhere to [Semantic Versioning](https://semver.org/).

## [0.3.3] — 2026-06-18

### Changed
- Mobile HUD: the block-rate donut is now integrated into the metrics bar (one
  unified box) instead of a separate top-right panel — fixes the mismatched
  heights, especially when the clients list is expanded. Desktop unchanged.

## [0.3.2] — 2026-06-18

### Added
- Mobile-responsive HUD (≤600px): metrics + donut stay compact, the live feed
  collapses to a "● Live" pill (tap to open/close), the clients card and panels
  cap to the viewport, and the controls reflow into one row (theme switcher shows
  O/A/N). Desktop unchanged.

## [0.3.1] — 2026-06-18

### Added
- Logout button (bottom-right, next to the theme/PTR controls) for logged-in
  users and guests; clears the session and returns to the login overlay.

### Changed
- The live feed box now matches the expanded Queries card (with the clients
  list): both are a stable 383px wide so the left column aligns, 11px feed rows
  with calmer line-height, and long client names truncate instead of resizing
  the box.

## [0.3.0] — 2026-06-16

### Added
- Optional password protection: set `DASHBOARD_PASSWORD` (and `SESSION_SECRET`)
  to gate the dashboard behind a login overlay. Login posts the password to the
  server, which sets a signed HttpOnly session cookie (30-day lifetime); the
  data endpoints (`/api/summary`, `/events`) require it. Unset = open (current
  behaviour). The session carries a `role` so a guest mode can be added later.
- Guest mode: with `GUEST_MODE=true` (and a dashboard password set), the login
  overlay offers a passwordless "Als Gast ansehen" view. Guests see the live
  graph + aggregate stats, but client names/IPs and domains are anonymized
  server-side (stable `Client N` / `site-N` pseudonyms) and the clients panel +
  live feed are hidden.

## [0.2.0] — 2026-06-14

### Added
- Client overview panel: clicking the top-left HUD "Clients" metric expands a
  panel with two tabs — **Aktiv** (live clients derived from the graph) and
  **Alle 24h** (per-client query/blocked counts from the Pi-hole `top_clients`
  API, broadcast via a new `clients` SSE event). Clicking a row highlights that
  client's node in the graph. Tailscale enrichment is deferred to a follow-up.

## [0.1.0] — 2026-06-12

First tagged release of the live Pi-hole DNS graph.

### Added
- Real-time force-directed graph of clients ↔ domains, fed by the Pi-hole v6
  API over an SSE pipeline (poller → broadcaster → web).
- HUD with today's totals, block-rate donut, and a live query feed.
- Live indicator dot (pulsing when connected, red blink when offline) in the
  feed header, with the app version shown alongside.
- Theme switcher (Obsidian / Aurora / Nord), persisted to localStorage.
- PTR / reverse-DNS filter toggle that hides reverse lookups from graph and feed.
- Touch support: one-finger pan and two-finger pinch-zoom (also over nodes).

### Fixed
- Pinch-zoom now works when a finger starts on a node, instead of dragging the
  node — a second pointer cancels the node drag and zooms.
- Block-rate donut color now follows the active theme.

### Notes
- The HUD version is sourced from `web/package.json` via a Vite `define`.
- Deployed to the Raspberry Pi via a single squashed snapshot on the public
  `d56de/pigraph` repo (see README).

[0.1.0]: https://github.com/d56de/pigraph
