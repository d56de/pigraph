# Dashboard Password Protection (v1: single user) — Design

Date: 2026-06-16
Status: Approved (brainstorming)

## Overview

Gate the pigraph dashboard behind a single shared password. Threat model is
**Grundschutz** on a private LAN/Tailnet (not internet-exposed): keep casual
co-network viewers out, not defend against a determined attacker. A styled
login overlay posts the password to the server, which sets a **signed HttpOnly
session cookie**; the data endpoints (`/api/*` data + `/events`) require that
cookie. The session carries a `role` so a future **guest mode** is a pure
extension (out of scope here).

Cookie-session (not HTTP Basic Auth) is chosen deliberately: the frontend uses
`EventSource` for `/events`, which **cannot set Authorization headers** but
**does send cookies** automatically — so cookies are the natural fit, and they
also enable a styled login, logout, and roles.

## Goals

- One shared password (env `DASHBOARD_PASSWORD`) protects the live data.
- Styled login overlay in the dashboard look; no browser Basic-Auth prompt.
- Signed HttpOnly cookie, 30-day lifetime; survives deploys (stable secret).
- Auth is **opt-in**: if `DASHBOARD_PASSWORD` is unset, the app stays open (dev / current behaviour).
- Session carries `role: "user"` — guest mode later is an extension, not a rewrite.

## Non-Goals (this spec)

- Guest mode / read-only role (separate follow-up spec; the `role` hook is prepared).
- Multiple named users, password reset, account management.
- HTTPS, rate-limiting, hashed-at-rest password, CSRF tokens — internet-hardening
  deferred (LAN/Tailnet assumption). Noted as future hardening.
- Logout **button** in the UI (the `/api/logout` route exists; a control comes with guest mode).

## Architecture

```
Browser ──GET /api/me──▶ server: authenticated? role?
   │ (unauthenticated)
   ├─ LoginOverlay ──POST /api/login {password}──▶ verify (timing-safe) ─▶ Set-Cookie (signed, HttpOnly, 30d)
   └─ (authenticated) ─▶ connect /events (cookie sent automatically) + /api/summary
                          server: auth middleware on /api/summary + /events → 401 without valid cookie
```

### Server (`server/src/...`)

| Unit | Responsibility |
|------|----------------|
| `config.ts` | `dashboardPassword: string` (env `DASHBOARD_PASSWORD`, default `""` = auth off); `sessionSecret: string` (env `SESSION_SECRET`). |
| `auth.ts` (new) | pure `verifyPassword(input, expected): boolean` (constant-time); cookie name + options constants. |
| `app.ts` | auth routes + middleware (below). `createApp` gains the auth deps (`password`, `sessionSecret`). |
| `index.ts` | pass `config.dashboardPassword` + a resolved `sessionSecret` into `createApp`. |

**Routes (all under the Hono app):**
- `POST /api/login` — body `{ password }`. If auth off → `200 {ok:true}`. Else timing-safe compare to `DASHBOARD_PASSWORD`; match → `setSignedCookie("pg_session", "user", secret, {httpOnly, sameSite:"Lax", path:"/", maxAge: 60*60*24*30})` → `200 {ok:true}`; mismatch → `401 {error:"falsches Passwort"}`.
- `POST /api/logout` — delete the cookie → `200 {ok:true}`.
- `GET /api/me` — if auth off → `{authenticated:true, role:"open"}`. Else read+verify signed cookie → `{authenticated: bool, role: "user"|null}`. Always `200` (status report, not gated).
- **Auth middleware** registered BEFORE `/api/summary` and `/events` only (login/logout/me and the static SPA stay public): if auth off → pass; else verify the signed cookie → invalid → `401 {error:"nicht angemeldet"}`.

**Session secret stability:** `SESSION_SECRET` must be stable across restarts so 30-day
cookies survive container rebuilds (every deploy recreates the container). `index.ts`
uses `config.sessionSecret`; if unset, it generates a random one at startup AND logs a
clear warning that sessions reset on restart until `SESSION_SECRET` is set in `.env`.
`.env.example` documents both `DASHBOARD_PASSWORD` and `SESSION_SECRET`.

**Static SPA stays public:** it's just the viewer shell (no data; the code is public on
GitHub anyway). Only the *data* (`/api/summary`, `/events`) is gated. The SPA renders the
login overlay itself based on `/api/me`.

### Web (`web/src/...`)

| Unit | Responsibility |
|------|----------------|
| `lib/auth/auth-store.ts` (new) | `authed` writable (`null` unknown / `true` / `false`); `checkAuth()` (GET /api/me), `login(pw)` (POST /api/login), `logout()`. |
| `lib/auth/LoginOverlay.svelte` (new) | full-screen dark overlay: one password field + submit, error line on 401. Themed via existing CSS vars. |
| `App.svelte` | on mount `checkAuth()`. Render `<LoginOverlay>` while `$authed === false`. Initialise the dashboard (renderer + stream + summary) **only once authenticated** (`$authed === true` or open mode); on successful login, proceed. |

The dashboard's existing `onMount` data setup (connect `/events`, fetch `/api/summary`)
runs only after auth is confirmed — otherwise `/events`/`/api/summary` would 401. If the
session later expires and `/events` returns 401, the app re-checks `/api/me` and shows the
overlay again.

## Edge cases
- `DASHBOARD_PASSWORD` unset → open mode: `/api/me` reports `authenticated:true, role:"open"`, middleware is a pass-through, no overlay. (Local dev / current behaviour.)
- Wrong password → `401`, overlay shows an error, no cookie set.
- Tampered/expired cookie → `getSignedCookie` returns false → treated as unauthenticated.
- `SESSION_SECRET` unset while password set → random secret + startup warning; sessions don't survive restarts until set.
- Plain HTTP on LAN: the password travels in the POST body in cleartext — accepted for Grundschutz (the Pi-hole password is already plaintext in `.env`; Tailnet traffic is encrypted).

## Testing
- `verifyPassword`: correct match true, mismatch false, equal length vs different length both handled (constant-time helper).
- `config`: parses `DASHBOARD_PASSWORD` / `SESSION_SECRET`; empty password = auth off.
- `app` (Hono test via `app.request(...)`):
  - auth ON: `/api/summary` and `/events` → 401 without cookie; `POST /api/login` correct → `Set-Cookie` + 200, wrong → 401; with the returned cookie → `/api/summary` 200; `/api/me` reflects state.
  - auth OFF: all open; `/api/me` → `{authenticated:true, role:"open"}`.
- web: `auth-store` (`checkAuth`/`login`/`logout` against a mocked fetch) — state transitions.

## Rollout
Ships via the existing snapshot deploy. The user sets `DASHBOARD_PASSWORD` and
`SESSION_SECRET` in the Pi's `server/.env`; without them the app stays open
(so a forgotten env never locks anyone out unexpectedly). A 30-day cookie means
re-login is rare; with `SESSION_SECRET` set, sessions survive deploys.
