# Resolution Origin (Cache / Unbound / Blocked) — Design

Date: 2026-06-14
Status: Approved (brainstorming)

## Overview

Surface *where each DNS answer came from* — served from Pi-hole's cache, recursed
upstream via **Unbound** (`FORWARDED`), or blocked. The data already rides on every
query (`status`) and on the Pi-hole summary; the app currently collapses it to a
single `blocked` boolean and throws the rest away. This feature keeps the
distinction and shows it two ways:

1. The top-right **donut becomes a 3-segment ring** (Cache / Unbound / Blocked).
2. Each **live-feed row gets a small origin dot**.

No new data source and no Unbound access — `status` (per query) + `cached`/`forwarded`
(from the existing Pi-hole summary endpoint) are enough.

## Goals

- Classify every query's resolution origin: blocked / cache / unbound / other.
- HUD: 3-segment donut showing the cumulative Cache / Unbound / Blocked mix; the
  block-rate % stays as the center number.
- Feed: a per-row colored dot (cache / unbound / blocked) so individual Unbound
  queries are visible live.
- Theme-aware.

## Non-Goals (YAGNI)

- Unbound's own statistics (cache hit rate, recursion time) — the user has Grafana/InfluxDB for that.
- Full recursion path (client → domain → Unbound → authoritative).
- Per-domain/per-client origin breakdowns.

## Classification

A pure function maps a query to one origin bucket:

```
resolutionOrigin(status: string, blocked: boolean): "blocked" | "cache" | "unbound" | "other"
  blocked === true                  -> "blocked"   (GRAVITY/REGEX/DENYLIST/… already flagged server-side)
  status in {CACHE, CACHE_STALE}    -> "cache"
  status in {FORWARDED, FORWARD}    -> "unbound"
  otherwise (IN_PROGRESS, …)        -> "other"
```

Lives in `web/src/lib/hud/resolution-origin.ts` (pure, unit-tested). It trusts the
existing server-computed `blocked` flag, so the blocked-status list stays
single-sourced in `server/src/pihole-client.ts`.

## Architecture & data flow

| Unit | Change |
|------|--------|
| `shared/src/events.ts` | `SummaryEventSchema` += `cached: number`, `forwarded: number` (nonneg ints). |
| `server/src/pihole-client.ts` | `fetchSummary` reads `queries.cached` and `queries.forwarded` from `/api/stats/summary`. **Exact field names confirmed in the plan phase against the live API.** |
| `web/src/lib/hud/hud-store.ts` | `HudState` += `cached`, `forwarded` (from summary). `FeedItem` += `origin` (computed via `resolutionOrigin(event.status, event.blocked)` when building the feed item). |
| `web/src/lib/hud/resolution-origin.ts` | new pure classifier. |
| `web/src/lib/hud/Hud.svelte` | donut → 3-segment ring; feed rows get an origin dot. |
| `web/src/lib/theme/themes.ts` | css palette += `forwarded` (Unbound color) for each theme. |
| `web/src/App.svelte` | `applyTheme` sets `--forwarded`. |

```
Pi-hole summary ──cached/forwarded──▶ server fetchSummary ──SummaryEvent──▶ hud-store (HudState)
                                                                              └─▶ Hud donut (3 segments)
query.status + query.blocked ──▶ hud-store builds FeedItem.origin ──▶ Hud feed dot
```

## UI

### Donut (top-right) — 3-segment ring
- The single block-rate arc becomes three arcs around the ring, sized by each
  bucket's share of `totalQueries`: **Cache** (`cached/total`), **Unbound**
  (`forwarded/total`), **Blocked** (`blocked/total`). The remainder (other /
  in-progress) is the neutral track.
- Drawn with per-segment `stroke-dasharray` + `stroke-dashoffset` (each segment
  starts where the previous ended), same radius/width as today.
- Center keeps the block-rate `%` and the "Block-Rate" label.
- Colors: Cache = `--allowed`, Unbound = `--forwarded`, Blocked = `--blocked`,
  track = `--panel-border`.

### Feed rows — origin dot
- A small leading dot per row colored by origin: cache = `--allowed`,
  unbound = `--forwarded`, blocked = `--blocked`, other = `--text-dim`.
- Existing text styling stays (blocked = red + strikethrough). The dot adds the
  cache-vs-unbound distinction the text color doesn't currently carry.

### Color: `--forwarded` (Unbound)
- New css-palette entry per theme, an amber/gold tone distinct from green
  (`--allowed`), red (`--blocked`), and purple (`--client`). Concrete values set
  in the plan (e.g. obsidian `#fbbf24`, aurora/nord analogues).

## Edge cases
- `total === 0` (fresh start): all segments empty, donut shows the neutral track; center `0.0%`.
- `cached`/`forwarded` missing from the summary (older Pi-hole): default to `0`; the
  donut just shows blocked vs track. Server maps absent fields to `0`.
- Segment rounding: segments are drawn from raw fractions; tiny gaps are acceptable
  (no forced normalization to exactly 100%).

## Testing
- `resolutionOrigin` pure fn: blocked precedence, cache, unbound, other (unit).
- `SummaryEventSchema` parse incl. new fields + defaulting when absent (shared).
- `fetchSummary` maps `cached`/`forwarded` (server, mock fetch).
- `hud-store`: summary populates `cached`/`forwarded`; `FeedItem.origin` is set from status+blocked.
- Donut segment math (if extracted to a pure helper `donutSegments(counts)` → array of `{dash, offset, color}`) — unit-tested.

## Rollout
Ships via the existing snapshot deploy. No env/config changes; uses the same
Pi-hole session.
