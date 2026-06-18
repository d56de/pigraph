# Dashboard Password Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the live dashboard behind a single shared password via a styled login overlay + a signed HttpOnly session cookie.

**Architecture:** A Hono auth middleware protects the data routes (`/api/summary` + `/events`); `POST /api/login` verifies the password (timing-safe) and sets a signed 30-day cookie; `GET /api/me` reports status. Auth is opt-in (no `DASHBOARD_PASSWORD` ⇒ open mode). The Svelte app checks `/api/me` on mount, shows a `LoginOverlay` when unauthenticated, and only starts the data stream once authenticated. The session stores a `role` so guest mode is a later extension.

**Tech Stack:** TypeScript, Hono (+ `hono/cookie`), Node crypto, Svelte 5 runes, Vitest.

Spec: `docs/superpowers/specs/2026-06-16-dashboard-auth-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/src/config.ts` | `dashboardPassword`, `sessionSecret` from env |
| `server/src/auth.ts` (new) | pure `verifyPassword` (constant-time) + cookie constants |
| `server/src/app.ts` | auth routes (`/api/login`, `/api/logout`, `/api/me`) + `requireAuth` middleware on data routes |
| `server/src/index.ts` | resolve `sessionSecret` (random fallback + warn), pass auth deps to `createApp` |
| `server/.env.example` | document `DASHBOARD_PASSWORD`, `SESSION_SECRET` |
| `web/src/lib/auth/auth-store.ts` (new) | `authed` store + `checkAuth`/`login`/`logout` |
| `web/src/lib/auth/LoginOverlay.svelte` (new) | dark login overlay |
| `web/src/App.svelte` | check auth on mount, render overlay, start data only when authed |

---

## Task 1: config + `verifyPassword`

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/auth.ts`
- Test: `server/test/config.test.ts`, `server/test/auth.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Append to `server/test/config.test.ts` — extend the existing `toEqual` and add an override:
```ts
  it("defaults auth fields to empty (auth off)", () => {
    const cfg = loadConfig(valid);
    expect(cfg.dashboardPassword).toBe("");
    expect(cfg.sessionSecret).toBe("");
  });

  it("reads DASHBOARD_PASSWORD and SESSION_SECRET", () => {
    const cfg = loadConfig({ ...valid, DASHBOARD_PASSWORD: "geheim", SESSION_SECRET: "s3cr3t" });
    expect(cfg.dashboardPassword).toBe("geheim");
    expect(cfg.sessionSecret).toBe("s3cr3t");
  });
```
Also update the existing `expect(cfg).toEqual({...})` in the first test to include the two new fields:
```ts
      clientNameSuffix: "fritz.box",
      dashboardPassword: "",
      sessionSecret: "",
```

Create `server/test/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { verifyPassword } from "../src/auth.js";

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword("geheim", "geheim")).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyPassword("falsch", "geheim")).toBe(false);
  });
  it("rejects against an empty expected (auth off)", () => {
    expect(verifyPassword("anything", "")).toBe(false);
  });
  it("rejects different-length inputs without throwing", () => {
    expect(verifyPassword("x", "geheim")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `verifyPassword` not found / `cfg.dashboardPassword` undefined.

- [ ] **Step 3: Implement**

Create `server/src/auth.ts`:
```ts
import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pg_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage in Sekunden

/** Konstantzeit-Vergleich: beide Seiten auf 32 Byte hashen, dann timingSafeEqual. Leeres Soll-Passwort = nie ok. */
export function verifyPassword(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
```

In `server/src/config.ts`, add to the `Config` interface (after `clientNameSuffix`):
```ts
  /** Login-Passwort fürs Dashboard. Leer = kein Schutz (offen). */
  dashboardPassword: string;
  /** Secret zum Signieren des Session-Cookies. Leer = beim Start zufällig (überlebt keinen Neustart). */
  sessionSecret: string;
```
And to the returned object in `loadConfig` (after `clientNameSuffix`):
```ts
    dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
    sessionSecret: env.SESSION_SECRET ?? "",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.ts server/src/config.ts server/test/auth.test.ts server/test/config.test.ts
git commit -m "feat(server): config + timing-safe verifyPassword for dashboard auth"
```

---

## Task 2: auth routes + middleware + wiring

**Files:**
- Modify: `server/src/app.ts`, `server/src/index.ts`, `server/.env.example`
- Test: `server/test/app.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `server/test/app.test.ts`:

```ts
function authedApp() {
  return createApp({
    broadcaster: new Broadcaster(),
    fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    password: "geheim",
    sessionSecret: "test-secret",
  });
}
// extrahiert "pg_session=...." aus dem Set-Cookie-Header für Folge-Requests
function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("auth", () => {
  it("blocks /api/summary and /events without a session", async () => {
    const app = authedApp();
    expect((await app.request("/api/summary")).status).toBe(401);
    expect((await app.request("/events")).status).toBe(401);
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const app = authedApp();
    expect((await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "falsch" }),
    })).status).toBe(401);

    const ok = await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "geheim" }),
    });
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect(cookie).toContain("pg_session=");

    const res = await app.request("/api/summary", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("/api/me reflects auth state", async () => {
    const app = authedApp();
    await expect((await app.request("/api/me")).json()).resolves.toEqual({ authenticated: false, role: null });
    const ok = await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "geheim" }),
    });
    const me = await app.request("/api/me", { headers: { cookie: cookieFrom(ok) } });
    await expect(me.json()).resolves.toEqual({ authenticated: true, role: "user" });
  });

  it("stays open when no password is configured", async () => {
    const app = createApp({ broadcaster: new Broadcaster(), fetchSummary: vi.fn().mockResolvedValue(SUMMARY) });
    expect((await app.request("/api/summary")).status).toBe(200);
    await expect((await app.request("/api/me")).json()).resolves.toEqual({ authenticated: true, role: "open" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — routes/middleware not implemented (and the existing 3 tests still pass, since `password` defaults to undefined = auth off).

- [ ] **Step 3: Implement** — rewrite `server/src/app.ts`:

```ts
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { SummaryEvent } from "@pihole-viz/shared";
import type { Broadcaster } from "./broadcaster.js";
import { SESSION_COOKIE, SESSION_MAX_AGE, verifyPassword } from "./auth.js";

export interface AppDeps {
  broadcaster: Broadcaster;
  fetchSummary: () => Promise<SummaryEvent>;
  password?: string; // leer/undefined = Auth aus
  sessionSecret?: string;
}

const SSE_PING_INTERVAL_MS = 15_000;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const password = deps.password ?? "";
  const secret = deps.sessionSecret ?? "";
  const authEnabled = password.length > 0;

  const requireAuth = async (c: Context, next: Next) => {
    if (!authEnabled) return next();
    const v = await getSignedCookie(c, secret, SESSION_COOKIE);
    if (v === "user") return next();
    return c.json({ error: "nicht angemeldet" }, 401);
  };

  app.post("/api/login", async (c) => {
    if (!authEnabled) return c.json({ ok: true });
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    if (verifyPassword(String(body.password ?? ""), password)) {
      await setSignedCookie(c, SESSION_COOKIE, "user", secret, {
        httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE,
      });
      return c.json({ ok: true });
    }
    return c.json({ error: "falsches Passwort" }, 401);
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    if (!authEnabled) return c.json({ authenticated: true, role: "open" });
    const v = await getSignedCookie(c, secret, SESSION_COOKIE);
    const ok = v === "user";
    return c.json({ authenticated: ok, role: ok ? "user" : null });
  });

  // Geschützte Datenrouten (Middleware VOR den Handlern registrieren):
  app.use("/api/summary", requireAuth);
  app.use("/events", requireAuth);

  app.get("/api/summary", async (c) => {
    try {
      return c.json(await deps.fetchSummary());
    } catch (err) {
      console.error("[summary]", err);
      return c.json({ error: "Pi-hole nicht erreichbar" }, 502);
    }
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = deps.broadcaster.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      while (open) {
        await stream.sleep(SSE_PING_INTERVAL_MS);
        await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  return app;
}
```

In `server/src/index.ts`, resolve the secret + pass auth deps. Add the import:
```ts
import { randomBytes } from "node:crypto";
```
Replace the `createApp({ ... })` call with:
```ts
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
});
```

Append to `server/.env.example`:
```
# Dashboard-Login (optional): leer lassen = kein Schutz (offen).
# CLIENT_NAME_SUFFIX bleibt oben; hier der Login:
# DASHBOARD_PASSWORD=einGutesPasswort
# Stabiles Secret zum Signieren der Session — sonst muss man nach jedem Neustart neu einloggen.
# Erzeugen z.B. mit:  openssl rand -hex 32
# SESSION_SECRET=...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS — new auth tests + all existing (auth-off path keeps `/api/summary` open).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/.env.example server/test/app.test.ts
git commit -m "feat(server): session-cookie auth on data routes + login/logout/me"
```

---

## Task 3: web auth-store

**Files:**
- Create: `web/src/lib/auth/auth-store.ts`
- Test: `web/test/auth-store.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/auth-store.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { authed, checkAuth, login, logout } from "../src/lib/auth/auth-store.js";

afterEach(() => vi.restoreAllMocks());

describe("auth-store", () => {
  it("checkAuth sets authed from /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) }));
    await checkAuth();
    expect(get(authed)).toBe(true);
  });

  it("login returns true and sets authed on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    expect(await login("geheim")).toBe(true);
    expect(get(authed)).toBe(true);
  });

  it("login returns false and clears authed on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) }));
    expect(await login("falsch")).toBe(false);
    expect(get(authed)).toBe(false);
  });

  it("logout clears authed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await logout();
    expect(get(authed)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `web/src/lib/auth/auth-store.ts`:

```ts
import { writable } from "svelte/store";

/** null = noch unbekannt, true = eingeloggt/offen, false = Login nötig. */
export const authed = writable<boolean | null>(null);

export async function checkAuth(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    const data = (await res.json()) as { authenticated?: boolean };
    authed.set(!!data.authenticated);
  } catch {
    authed.set(false);
  }
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  authed.set(res.ok);
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
  authed.set(false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/auth/auth-store.ts web/test/auth-store.test.ts
git commit -m "feat(web): auth store (check/login/logout)"
```

---

## Task 4: LoginOverlay component

**Files:**
- Create: `web/src/lib/auth/LoginOverlay.svelte`

(No unit test — presentational; logic is in auth-store. Verified via build + QA in Task 6.)

- [ ] **Step 1: Create `web/src/lib/auth/LoginOverlay.svelte`:**

```svelte
<script lang="ts">
  import { login } from "./auth-store.js";

  let password = $state("");
  let error = $state(false);
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = false;
    const ok = await login(password);
    busy = false;
    if (!ok) {
      error = true;
      password = "";
    }
  }
</script>

<div class="overlay">
  <form class="card" onsubmit={submit}>
    <h1>pigraph</h1>
    <p>Bitte anmelden</p>
    <input
      type="password"
      bind:value={password}
      placeholder="Passwort"
      class:err={error}
      autocomplete="current-password"
      autofocus
    />
    {#if error}<span class="msg">Falsches Passwort</span>{/if}
    <button type="submit" disabled={busy || password.length === 0}>
      {busy ? "…" : "Anmelden"}
    </button>
  </form>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg);
  }
  .card {
    display: flex; flex-direction: column; gap: 12px; width: 260px;
    background: var(--panel); border: 1px solid var(--panel-border);
    border-radius: 12px; padding: 24px; backdrop-filter: blur(8px);
  }
  h1 { font-size: 22px; color: var(--text); font-family: -apple-system, "SF Pro Text", sans-serif; }
  p { font-size: 12px; color: var(--text-dim); margin-top: -6px; }
  input {
    background: var(--bg); border: 1px solid var(--panel-border); border-radius: 8px;
    padding: 10px 12px; font-size: 14px; color: var(--text); outline: none;
  }
  input:focus { border-color: var(--text-dim); }
  input.err { border-color: var(--blocked); }
  .msg { font-size: 12px; color: var(--blocked); margin-top: -6px; }
  button {
    background: var(--panel-border); border: none; border-radius: 8px;
    padding: 10px; font-size: 14px; color: var(--text); cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
```

- [ ] **Step 2: Type-check + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean (component not rendered yet; wired in Task 5).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth/LoginOverlay.svelte
git commit -m "feat(web): LoginOverlay component"
```

---

## Task 5: Gate the dashboard in App.svelte

**Files:**
- Modify: `web/src/App.svelte`

**READ the current `App.svelte` first.** It sets up the renderer in `onMount`, and inside
`renderer.init(container).then(...)` it calls `attachPanZoom(...)`, `connectStream("/events", {...})`,
and `applyTheme(lastTheme)`; separately it does a `void fetch("/api/summary")...` and starts a
`decayTimer`. We will: check auth on mount, render `<LoginOverlay>` when unauthenticated, and run
the **data** parts (`connectStream` + the `/api/summary` fetch) only once authenticated.

- [ ] **Step 1: Add imports** (with the other imports):
```ts
  import { authed, checkAuth } from "./lib/auth/auth-store.js";
  import LoginOverlay from "./lib/auth/LoginOverlay.svelte";
```
(`get` from `svelte/store` is already imported.)

- [ ] **Step 2: Gate the data start.** Inside `onMount`, introduce a guarded starter and only connect the stream / fetch the summary through it. Concretely:

a) Near the top of `onMount` (before `renderer = new GraphRenderer(...)`), add flags + the auth check:
```ts
    let rendererReady = false;
    let dataStarted = false;
    void checkAuth();
```

b) Define `startData()` inside `onMount` (after `render` is defined). MOVE the `connectStream(...)`
assignment and the `void fetch("/api/summary")...` block out of their current spots INTO this function:
```ts
    const startData = () => {
      if (dataStarted || !rendererReady || get(authed) !== true) return;
      dataStarted = true;
      disconnect = connectStream("/events", {
        onEvent(event) {
          if (event.type === "query" && event.recordType === "PTR" && get(hidePtr)) return;
          applyServerEvent(event);
          if (event.type === "query") {
            graph = applyQuery(graph, event, Date.now());
            render();
          } else if (event.type === "clients") {
            setClients(event.clients);
          }
        },
        onConnectionChange(connected) {
          applyServerEvent({ type: "status", state: connected ? "online" : "offline" });
        },
      });
      void fetch("/api/summary")
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          const parsed = SummaryEventSchema.safeParse(raw);
          if (parsed.success) applyServerEvent(parsed.data);
        })
        .catch(() => undefined);
    };
```

c) In the existing `renderer.init(container).then(() => { ... })`, KEEP `attachPanZoom(...)` and
`applyTheme(lastTheme)`, but REPLACE the `connectStream(...)` call there with the readiness flag +
starter:
```ts
      detachPanZoom = attachPanZoom(renderer!.canvas, renderer!.worldContainer, {
        isSuspended: () => renderer!.draggingNode,
        onPinch: () => renderer!.cancelDrag(),
      });
      applyTheme(lastTheme);
      rendererReady = true;
      startData();
```

d) Subscribe to `authed` so a successful login (after the renderer is ready) starts the data:
```ts
    const unsubAuthed = authed.subscribe(() => startData());
```
Add `unsubAuthed();` to the `onMount` cleanup `return () => { ... }`.

- [ ] **Step 3: Render the overlay.** In the markup, after the `<Hud ... />` block (or anywhere
top-level), add:
```svelte
{#if $authed === false}
  <LoginOverlay />
{/if}
```

- [ ] **Step 4: Type-check, build, test**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.svelte
git commit -m "feat(web): gate dashboard behind login overlay"
```

---

## Task 6: Verify + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full suite + builds**

Run: `npm test` (root) then `cd web && npm run build`
Expected: all suites pass, build clean.

- [ ] **Step 2: Local QA — auth OFF (default)**

The local `server/.env` has no `DASHBOARD_PASSWORD`. Open `http://localhost:5173`: the dashboard
loads directly (no overlay), `/api/me` returns `{authenticated:true, role:"open"}`. Confirms the
open-mode path is intact.

- [ ] **Step 3: Local QA — auth ON**

Temporarily add to `server/.env`: `DASHBOARD_PASSWORD=test123` and `SESSION_SECRET=localtest`, let
`dev:server` restart, reload `http://localhost:5173`:
- Login overlay appears; wrong password → "Falsches Passwort"; `test123` → dashboard loads, stream connects.
- After login, `dig`-free check: the graph/feed populate. Reload → still logged in (cookie).
Then REMOVE those two lines from `server/.env` again (back to open dev mode).

- [ ] **Step 4: Deploy to the Pi**

Per `deploy-pipeline` project memory:
1. Snapshot + force-push (user runs): `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force`
2. **Before/after the rebuild, the user sets the secrets on the Pi:** add `DASHBOARD_PASSWORD=...`
   and `SESSION_SECRET=$(openssl rand -hex 32)` to `/home/pi/pihole-viz/server/.env` (the root `.env`
   the compose uses — confirm which `.env` the server reads on the Pi during this step).
3. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main && docker-compose up -d --build --force-recreate`.
4. Verify: `http://<pi>:8089` shows the login overlay; correct password → dashboard; `/api/summary`
   returns 401 without the cookie.

- [ ] **Step 5: Update CHANGELOG**

Add under `## [Unreleased]` in `CHANGELOG.md`:
```
### Added
- Optional password protection: set DASHBOARD_PASSWORD (+ SESSION_SECRET) to gate
  the dashboard behind a login overlay (signed 30-day session cookie). Unset = open.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for dashboard password protection"
```

---

## Self-Review notes

- **Spec coverage:** opt-in via `DASHBOARD_PASSWORD` (Task 1/2, open-mode tested), middleware on `/api/summary`+`/events` (Task 2), login/logout/me (Task 2), signed HttpOnly 30-day cookie (Task 2 via `SESSION_MAX_AGE`), stable secret + random fallback warning (Task 2 index.ts), styled overlay (Task 4), SPA gates data on `/api/me` (Task 5), `role` in session for future guest mode (Task 2 `/api/me` returns role). ✓
- **Type consistency:** `verifyPassword`, `SESSION_COOKIE`, `SESSION_MAX_AGE` defined in Task 1 `auth.ts`, used in Task 2 `app.ts`; `AppDeps.password?/sessionSecret?` optional keeps the 3 existing app tests passing (auth off); `authed`/`checkAuth`/`login`/`logout` from Task 3 consumed in Tasks 4/5. ✓
- **Non-breaking:** auth is opt-in; existing `createApp` callers/tests without a password run in open mode. Local dev stays open. ✓
- **Known follow-ups (out of scope):** guest role, logout button, HTTPS/rate-limiting.
