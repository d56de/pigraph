# Unbound per Client (live) — Design

Date: 2026-06-15
Status: Approved (brainstorming)

## Overview

Show, per client, how many of its queries were recursed via **Unbound** (Pi-hole
status `FORWARDED`), and sort the client panel's **Aktiv** tab by that count so the
clients driving the most upstream recursion surface at the top. This answers "which
clients use Unbound" — with the caveat that *every* client uses Unbound for
cache-misses, so the meaningful signal is the per-client forwarded *volume*.

Builds directly on the resolution-origin work: `resolutionOrigin(status, blocked)`
already classifies a query as `"unbound"`. This feature just counts those per client.

## Goals

- Track a live per-client `forwarded` (Unbound) count, derived from the query stream.
- Aktiv tab: a `↑ <n>` column (amber, `--forwarded`) per row, next to the existing
  blocked count + % blocked.
- Aktiv tab sorted by `forwarded` descending (tie-break: total) → top Unbound clients on top.

## Non-Goals (YAGNI)

- Clickable sort headers / multi-sort UI — a single sensible default sort suffices.
- 24h per-client cache/forward split — Pi-hole `top_clients` only exposes total +
  blocked; the 24h tab shows `↑ –`.
- A per-client cache-quota column or mini split-bar (considered, deferred).
- Any Unbound-control / direct Unbound access.

## Architecture & data flow

| Unit | Change |
|------|--------|
| `web/src/lib/graph/store.ts` | `GraphNode` += optional `forwarded?: number`; `applyQuery` increments the client node's `forwarded` when the query's origin is `"unbound"`; `tick` preserves `forwarded` when it rebuilds client nodes. |
| `web/src/lib/clients/active-clients.ts` | `ActiveClient` += `forwarded: number` (read from the client node); sort changes to `forwarded` desc, tie-break `total` desc. |
| `web/src/lib/clients/ClientsList.svelte` | Aktiv rows get a `↑ <n>` amber column; 24h rows show `↑ –`. |

`resolutionOrigin` (and its `ResolutionOrigin` type) stay in `web/src/lib/hud/`;
`graph/store.ts` imports the pure leaf function from there — no layering issue
(it depends on nothing).

```
query.status + query.blocked ──resolutionOrigin──▶ applyQuery increments client.forwarded
graph client node.forwarded ──▶ activeClients(state) → ActiveClient.forwarded (sorted by it)
                                                    └─▶ ClientsList Aktiv tab "↑ n" column
clients24h (no split) ──▶ ClientsList 24h tab "↑ –"
```

## Details

### Counting (`applyQuery`)
- When building/updating the client node, compute `isUnbound = resolutionOrigin(query.status, query.blocked) === "unbound"` and set
  `forwarded: (client?.forwarded ?? 0) + (isUnbound ? 1 : 0)`.
- The count is monotonic within the live window; it decays with the client node when
  the node ages out (same lifecycle as `hits`). `tick` must carry `forwarded` over
  when it reconstructs nodes (alongside `hits`, `lastSeen`, etc.).
- `forwarded` is only meaningful on client nodes; domain nodes leave it unset.

### Derivation + sort (`active-clients.ts`)
- `ActiveClient` gains `forwarded: number`, read directly from `node.forwarded ?? 0`
  (precise per-client, unlike `total`/`blocked` which are summed from edges).
- Sort: `forwarded` desc, then `total` desc as tie-break (so zero-Unbound clients
  still order sensibly by volume).

### UI (`ClientsList.svelte`)
- Aktiv row gains a right-aligned `↑ <forwarded>` cell, colored `--forwarded` (amber),
  placed before the blocked count and %. The `↑` glyph signals "forwarded upstream".
- 24h rows render `↑ –` (dim) in the same column — the split isn't available there.
- Row stays monospace/tabular. The grid widens to fit the extra number; the panel
  `min-width` bumps modestly if needed so three numbers + name (+ ip when it differs)
  don't crowd.

## Edge cases
- Client with zero Unbound queries → `↑ 0`, sorts below clients with forwards.
- A `FORWARDED` query that is also `blocked` → classifies as `blocked` (blocked wins
  in `resolutionOrigin`), so it does NOT count toward `forwarded`. Correct.
- 24h tab: always `↑ –`; its existing total-desc sort is unchanged.

## Testing
- `applyQuery`: a `FORWARDED` non-blocked query increments the client node's
  `forwarded`; a `CACHE` query and a blocked query do not.
- `tick`: `forwarded` survives a decay tick (not reset to 0).
- `activeClients`: `forwarded` is read per client and the result is sorted by
  `forwarded` desc with `total` tie-break.

## Rollout
Frontend + graph-store only; no shared/server/schema change, no new data source.
Ships via the existing snapshot deploy.
