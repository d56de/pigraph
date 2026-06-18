# Guest Mode (v1) — Design

Date: 2026-06-16
Status: Approved (brainstorming)

Builds on [2026-06-16-dashboard-auth-design.md] (the v1 password protection), which
already reserved a `role` in the session cookie for exactly this extension.

## Overview

Add a no-password **guest** view: a "Als Gast ansehen" button on the login overlay
starts a restricted session that shows the living, pulsing graph and the aggregate
HUD stats, but **server-side anonymizes all identifying data** before it reaches the
guest's browser — client names/IPs and domain names become stable pseudonyms — and
hides the clients panel and the live query feed. The intended use is a wall display
or showing a visitor the visualization without leaking the household's devices or
browsing.

## Threat model & the one architectural rule

Guest mode exists specifically to withhold private data from someone who is NOT
trusted with the full view. Therefore restriction MUST be enforced **server-side**:
the `/events` stream emits anonymized events for a guest session, so the real
`clientName`/`clientIp`/`domain` never reach the guest's browser. Client-side hiding
(send everything, hide in the UI) is rejected — the data would sit in the page,
visible via DevTools/Network. The frontend still hides the panel/feed for guests as
defense-in-depth, but the security boundary is the server.

## Goals

- A `GUEST_MODE=true` flag (only meaningful when `DASHBOARD_PASSWORD` is set) enables a
  passwordless "Als Gast ansehen" entry.
- Guest sessions reach the live graph + aggregate stats, with: client identities
  anonymized, domain names anonymized, clients panel hidden, live feed hidden.
- Anonymization is server-side and stable (same real value → same pseudonym), so
  graph topology and activity stay coherent while names stay hidden.
- Reuses the v1 signed-cookie session; the cookie value carries the role (`user` vs
  `guest`).

## Non-Goals (YAGNI)

- Per-guest pseudonym namespaces (a single global map is fine; pseudonyms reveal nothing).
- Guest mode in open mode (no password) — pointless; everything is already open.
- Configurable per-field guest visibility — v1 hides all four chosen items as one mode.
- A guest password (the user chose a passwordless button); the role hook still allows
  adding one later without rework.
- Rate-limiting / abuse protection on `/api/guest` (LAN/Tailnet Grundschutz).

## Architecture & data flow

```
Login overlay (guestEnabled && !authenticated)
   ├─ password → POST /api/login → cookie "user"
   └─ "Als Gast ansehen" → POST /api/guest → cookie "guest"   (only if GUEST_MODE)

/events  (requireAuth allows user AND guest)
   role "user"  → events sent as-is
   role "guest" → each event through anonymizeEvent():
                    query   → clientName/clientIp → "Client N", domain → "site-N"
                    clients → SUPPRESSED
                    summary → unchanged   (aggregate, safe)
                    status  → unchanged
/api/summary → aggregate, allowed for guest
/api/me → { authenticated, role: "open"|"user"|"guest"|null, guestEnabled }
```

### Server (`server/src/...`)

| Unit | Change |
|------|--------|
| `config.ts` | `guestMode: boolean` from `env.GUEST_MODE === "true"`. |
| `app.ts` | `createApp` deps gain `guestMode?: boolean`. `requireAuth` accepts cookie value `"user"` OR `"guest"`. New `POST /api/guest`: only when `guestMode && authEnabled`, sets a signed cookie value `"guest"` (same opts/maxAge as login) → 200; otherwise 404. `/api/me` returns the role derived from the cookie (`"guest"` when the cookie is `"guest"`) and `guestEnabled: guestMode && authEnabled`. The `/events` handler reads the role from the cookie and, when `"guest"`, wraps the broadcaster callback with `anonymizeEvent` and drops `clients` events. |
| `anonymize.ts` (new) | `createAnonymizer()` → `{ anonymizeEvent(event): ServerEvent | null }`. Holds two `Map`s (realClient→label, realDomain→label) + counters. `query` events: replace `clientName`+`clientIp` with `Client <n>` (keyed by `clientIp`), `domain` with `site-<n>` (keyed by `domain`); keep `status/blocked/recordType/timestamp`. `clients` → returns `null` (suppress). `summary`/`status` → returned unchanged. Pure/deterministic given its internal map; stable for the process lifetime. |

Cookie role read: `getSignedCookie` returns `"user"`, `"guest"`, `false`, or `undefined`.
`requireAuth` passes when the value is `"user"` or `"guest"`. A single helper
`sessionRole(c): "user" | "guest" | null` is used by `requireAuth`, `/api/me`, and `/events`.

The anonymizer instance: one per server process (created in `index.ts` or `createApp`),
shared across all guest connections, so all guests see the same stable pseudonyms.
(Each guest SSE subscription applies `anonymizeEvent` to the shared broadcast.)

### Web (`web/src/...`)

| Unit | Change |
|------|--------|
| `lib/auth/auth-store.ts` | `authed` stays, plus a `role` writable (`"open"\|"user"\|"guest"\|null`) and `guestEnabled` (boolean). `checkAuth()` reads all three from `/api/me`. New `loginAsGuest()` → `POST /api/guest` → on ok sets `authed=true`, `role="guest"`. `login()` sets `role="user"`. |
| `lib/auth/LoginOverlay.svelte` | When `guestEnabled` is true, render a secondary "Als Gast ansehen" button below "Anmelden" that calls `loginAsGuest()`. |
| `App.svelte` | Derive `isGuest = $role === "guest"`. Pass it to `Hud` (and/or gate rendering) so the **Clients control + panel** and the **live feed** are hidden for guests. Data-start gating unchanged (guest counts as authenticated). |
| `lib/hud/Hud.svelte` | Accept an `isGuest` prop; when true, hide the Clients button/panel and the feed section. Aggregate metrics + donut stay. |

The graph renders anonymized `query` events with no special-casing — pseudonymous
labels (`Client 7`, `site-3`) flow through `applyQuery`/cluster/render as normal
strings; tooltips show the pseudonyms. Registrable-domain grouping over `site-N`
labels simply doesn't cluster (each is its own group) — acceptable, no crash.

## Edge cases
- `GUEST_MODE` unset/false → `guestEnabled:false`, no overlay button, `POST /api/guest` → 404.
- Open mode (no `DASHBOARD_PASSWORD`) → `guestEnabled:false` (guest mode needs auth on).
- Guest cookie present but `GUEST_MODE` later turned off → `requireAuth` still treats a
  valid `"guest"` cookie as authenticated (the data is anonymized anyway); `/api/me`
  reports `role:"guest", guestEnabled:false`. Acceptable; the cookie expires in 30 days.
- Anonymizer map resets on server restart → pseudonyms renumber; harmless.
- A guest never receives `clients` events, so the panel would be empty even if shown;
  the frontend hides it regardless (defense-in-depth).

## Testing
- `anonymize.ts`: a `query` event has `clientName`/`clientIp`/`domain` replaced; the same
  real client/domain yields the same pseudonym across calls; two different reals get
  different pseudonyms; `status`/`blocked` are preserved; a `clients` event returns
  `null` (suppressed); `summary`/`status` pass through unchanged.
- `app.ts` (via `app.request`): `POST /api/guest` sets a `guest` cookie when
  `guestMode && password` set, else 404; the guest cookie reaches `/api/summary` and
  `/events` (200, not 401); `/api/me` with a guest cookie → `{authenticated:true, role:"guest", guestEnabled:true}`; with no `GUEST_MODE` → `guestEnabled:false` and `/api/guest` 404; a `user` cookie still works.
- `config.ts`: `GUEST_MODE=true` → `guestMode:true`, default false.
- web `auth-store`: `checkAuth` sets `role`+`guestEnabled`; `loginAsGuest()` sets
  `role:"guest"` on 200, leaves it on failure.
- web `App`/`Hud`: with `role="guest"`, the Clients control/panel and feed are not
  rendered; aggregate HUD is.

## Rollout
Ships via the existing snapshot deploy. On the Pi, add `GUEST_MODE=true` to the root
`.env` (alongside `DASHBOARD_PASSWORD`/`SESSION_SECRET`). Without it, nothing changes
(no guest button). Verify at the endpoint: the overlay shows the guest button; the
guest session's `/events` payload contains only `Client N` / `site-N` labels and no
`clients` events (inspect the served stream, not just the build).
