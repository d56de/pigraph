# Guest Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a passwordless "Als Gast ansehen" view that shows the live graph + aggregate stats with all identifying data (client names/IPs, domains) anonymized server-side, and the clients panel + live feed hidden.

**Architecture:** Extends the v1 cookie-session auth. The session cookie value carries the role (`user` vs `guest`). A `GUEST_MODE` flag enables a `POST /api/guest` route that issues a `guest` cookie without a password. For a guest connection, the `/events` stream pipes every event through a server-side anonymizer (real client/domain → stable pseudonyms; `clients` events suppressed; `summary`/`status` unchanged) so private data never reaches the guest's browser. The frontend tracks the role and hides the clients control + feed for guests.

**Tech Stack:** TypeScript, Hono (+ hono/cookie), Zod (shared events), Svelte 5 runes, Vitest.

Spec: `docs/superpowers/specs/2026-06-16-guest-mode-design.md`. Builds on `docs/superpowers/specs/2026-06-16-dashboard-auth-design.md`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/src/anonymize.ts` (new) | `createAnonymizer()` → stable per-process pseudonymizer for guest events |
| `server/src/config.ts` | `guestMode: boolean` from `GUEST_MODE` env |
| `server/src/app.ts` | guest cookie role, `POST /api/guest`, `/api/me` role+guestEnabled, `/events` per-role anonymization |
| `server/src/index.ts` | pass `guestMode` into `createApp` |
| `server/.env.example` | document `GUEST_MODE` |
| `web/src/lib/auth/auth-store.ts` | `role` + `guestEnabled` stores, `loginAsGuest()` |
| `web/src/lib/auth/LoginOverlay.svelte` | "Als Gast ansehen" button when guest enabled |
| `web/src/App.svelte` | pass `isGuest` to Hud |
| `web/src/lib/hud/Hud.svelte` | hide clients control + feed for guests |

---

## Task 1: Anonymizer + config flag

**Files:**
- Create: `server/src/anonymize.ts`
- Modify: `server/src/config.ts`
- Test: `server/test/anonymize.test.ts` (new), `server/test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/test/anonymize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@pihole-viz/shared";
import { createAnonymizer } from "../src/anonymize.js";

const query = (over: Partial<Record<string, unknown>> = {}): ServerEvent =>
  ({
    type: "query", id: 1, time: 1000, domain: "ads.example.com",
    clientIp: "192.168.1.5", clientName: "laptop", blocked: false, status: "FORWARDED",
    ...over,
  }) as ServerEvent;

describe("createAnonymizer", () => {
  it("replaces client + domain in a query, keeps status/blocked", () => {
    const a = createAnonymizer();
    const out = a.anonymizeEvent(query());
    expect(out).toMatchObject({ type: "query", status: "FORWARDED", blocked: false });
    expect(out && "clientName" in out && out.clientName).toBe("Client 1");
    expect(out && "clientIp" in out && out.clientIp).toBe("Client 1");
    expect(out && "domain" in out && out.domain).toBe("site-1");
  });

  it("is stable: same real values → same pseudonyms", () => {
    const a = createAnonymizer();
    const a1 = a.anonymizeEvent(query());
    const a2 = a.anonymizeEvent(query({ id: 2 }));
    expect(a2).toMatchObject({ domain: "site-1", clientName: "Client 1" });
  });

  it("gives different reals different pseudonyms", () => {
    const a = createAnonymizer();
    a.anonymizeEvent(query());
    const a2 = a.anonymizeEvent(query({ clientIp: "10.0.0.9", domain: "cdn.test.net" }));
    expect(a2).toMatchObject({ clientName: "Client 2", domain: "site-2" });
  });

  it("suppresses clients events (returns null)", () => {
    const a = createAnonymizer();
    expect(a.anonymizeEvent({ type: "clients", generatedAt: 1, clients: [] })).toBeNull();
  });

  it("passes summary and status through unchanged", () => {
    const a = createAnonymizer();
    const summary: ServerEvent = { type: "summary", totalQueries: 5, blockedQueries: 1, percentBlocked: 20, activeClients: 2 };
    const status: ServerEvent = { type: "status", state: "online" };
    expect(a.anonymizeEvent(summary)).toEqual(summary);
    expect(a.anonymizeEvent(status)).toEqual(status);
  });
});
```

Append to `server/test/config.test.ts` (uses the existing `valid` fixture + `loadConfig`):
```ts
  it("reads GUEST_MODE", () => {
    expect(loadConfig(valid).guestMode).toBe(false);
    expect(loadConfig({ ...valid, GUEST_MODE: "true" }).guestMode).toBe(true);
  });
```
Also extend the existing `expect(loadConfig(valid)).toEqual({...})` assertion to include `guestMode: false` (place it next to `dashboardPassword: ""` / `sessionSecret: ""`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `createAnonymizer` not found, `cfg.guestMode` undefined.

- [ ] **Step 3: Implement**

Create `server/src/anonymize.ts`:
```ts
import type { ServerEvent } from "@pihole-viz/shared";

export interface Anonymizer {
  /** Gast-Sicht: ersetzt Identitäten durch stabile Pseudonyme; clients-Events → null (unterdrückt). */
  anonymizeEvent(event: ServerEvent): ServerEvent | null;
}

export function createAnonymizer(): Anonymizer {
  const clients = new Map<string, string>();
  const domains = new Map<string, string>();

  const label = (map: Map<string, string>, key: string, make: (n: number) => string): string => {
    const hit = map.get(key);
    if (hit) return hit;
    const value = make(map.size + 1);
    map.set(key, value);
    return value;
  };

  return {
    anonymizeEvent(event) {
      switch (event.type) {
        case "query": {
          const who = label(clients, event.clientIp, (n) => `Client ${n}`);
          return {
            ...event,
            clientIp: who,
            clientName: who,
            domain: label(domains, event.domain, (n) => `site-${n}`),
          };
        }
        case "clients":
          return null; // identitätslastig → unterdrücken
        default:
          return event; // summary, status: Aggregat/Zustand, unkritisch
      }
    },
  };
}
```

In `server/src/config.ts`, add to the `Config` interface (after `sessionSecret`):
```ts
  /** Gast-Modus (passwortloser, anonymisierter Read-Only-Blick). Nur wirksam mit dashboardPassword. */
  guestMode: boolean;
```
And to the `loadConfig` return object (after `sessionSecret`):
```ts
    guestMode: env.GUEST_MODE === "true",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/anonymize.ts server/src/config.ts server/test/anonymize.test.ts server/test/config.test.ts
git commit -m "feat(server): guest-event anonymizer + GUEST_MODE config"
```

---

## Task 2: Guest role, /api/guest, role-aware stream

**Files:**
- Modify: `server/src/app.ts`, `server/src/index.ts`, `server/.env.example`
- Test: `server/test/app.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `server/test/app.test.ts`:

(The file already has `cookieFrom(res)` and `SUMMARY` from the auth feature.)
```ts
function guestApp() {
  return createApp({
    broadcaster: new Broadcaster(),
    fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    password: "geheim",
    sessionSecret: "test-secret",
    guestMode: true,
  });
}

describe("guest mode", () => {
  it("issues a guest session that reaches the data routes", async () => {
    const app = guestApp();
    const g = await app.request("/api/guest", { method: "POST" });
    expect(g.status).toBe(200);
    const cookie = cookieFrom(g);
    expect(cookie).toContain("pg_session=");
    expect((await app.request("/api/summary", { headers: { cookie } })).status).toBe(200);
  });

  it("/api/me reports the guest role and guestEnabled", async () => {
    const app = guestApp();
    await expect((await app.request("/api/me")).json()).resolves.toEqual({
      authenticated: false, role: null, guestEnabled: true,
    });
    const g = await app.request("/api/guest", { method: "POST" });
    const me = await app.request("/api/me", { headers: { cookie: cookieFrom(g) } });
    await expect(me.json()).resolves.toEqual({ authenticated: true, role: "guest", guestEnabled: true });
  });

  it("404s /api/guest and reports guestEnabled:false when GUEST_MODE is off", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(), fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
      password: "geheim", sessionSecret: "test-secret",
    });
    expect((await app.request("/api/guest", { method: "POST" })).status).toBe(404);
    await expect((await app.request("/api/me")).json()).resolves.toEqual({
      authenticated: false, role: null, guestEnabled: false,
    });
  });

  it("anonymizes the event stream for a guest", async () => {
    const broadcaster = new Broadcaster();
    const app = createApp({
      broadcaster, fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
      password: "geheim", sessionSecret: "test-secret", guestMode: true,
    });
    const g = await app.request("/api/guest", { method: "POST" });
    const res = await app.request("/events", { headers: { cookie: cookieFrom(g) } });
    const reader = res.body!.getReader();
    broadcaster.broadcast({
      type: "query", id: 1, time: 1, domain: "ads.example.com",
      clientIp: "10.0.0.5", clientName: "laptop", blocked: false, status: "FORWARDED",
    });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).not.toContain("ads.example.com");
    expect(text).not.toContain("laptop");
    expect(text).toContain("site-1");
    expect(text).toContain("Client 1");
    await reader.cancel();
  });
});
```

ALSO update the THREE existing `/api/me` assertions in the auth `describe("auth", ...)` block to include `guestEnabled: false` (the new field; these apps have no `guestMode`):
- the open-mode test: `{ authenticated: true, role: "open", guestEnabled: false }`
- `/api/me` no cookie: `{ authenticated: false, role: null, guestEnabled: false }`
- `/api/me` user cookie: `{ authenticated: true, role: "user", guestEnabled: false }`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: the new guest tests FAIL, and the three updated `/api/me` asserts FAIL until implemented.

- [ ] **Step 3: Implement** — edit `server/src/app.ts`.

Add to the imports:
```ts
import type { ServerEvent } from "@pihole-viz/shared";
import { createAnonymizer } from "./anonymize.js";
```
Add to `AppDeps` (after `sessionSecret?`):
```ts
  guestMode?: boolean;
```
Inside `createApp`, after `const authEnabled = ...;` add:
```ts
  const guestEnabled = authEnabled && !!deps.guestMode;
  const anonymizer = createAnonymizer();

  const sessionRole = async (c: Context): Promise<"user" | "guest" | null> => {
    const v = await getSignedCookie(c, secret, SESSION_COOKIE);
    if (v === "user") return "user";
    if (v === "guest") return "guest";
    return null;
  };
```
Replace the `requireAuth` body to accept either role:
```ts
  const requireAuth = async (c: Context, next: Next) => {
    if (!authEnabled) return next();
    if (await sessionRole(c)) return next();
    return c.json({ error: "nicht angemeldet" }, 401);
  };
```
Add the guest route (next to `/api/login`):
```ts
  app.post("/api/guest", async (c) => {
    if (!guestEnabled) return c.json({ error: "nicht verfügbar" }, 404);
    await setSignedCookie(c, SESSION_COOKIE, "guest", secret, {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE,
    });
    return c.json({ ok: true });
  });
```
Replace `/api/me` with:
```ts
  app.get("/api/me", async (c) => {
    if (!authEnabled) return c.json({ authenticated: true, role: "open", guestEnabled: false });
    const role = await sessionRole(c);
    return c.json({ authenticated: role !== null, role, guestEnabled });
  });
```
Replace the `/events` handler body so a guest stream is anonymized (note: only read the role when `authEnabled`, to avoid verifying a cookie with an empty secret in open mode):
```ts
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const role = authEnabled ? await sessionRole(c) : null;
      const transform = (event: ServerEvent): ServerEvent | null =>
        role === "guest" ? anonymizer.anonymizeEvent(event) : event;
      let open = true;
      const unsubscribe = deps.broadcaster.subscribe((event) => {
        const out = transform(event);
        if (out) void stream.writeSSE({ data: JSON.stringify(out) });
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
```
(`deps.broadcaster.subscribe` passes a `ServerEvent`; if its callback param is currently untyped, the `transform(event)` call infers it — add `event: ServerEvent` in the broadcaster type only if tsc complains.)

In `server/src/index.ts`, add `guestMode: config.guestMode,` to the `createApp({...})` call (alongside `password`/`sessionSecret`).

Append to `server/.env.example`:
```
# Gast-Modus (optional, nur mit DASHBOARD_PASSWORD): zeigt einen passwortlosen,
# anonymisierten Read-Only-Blick (Clients/Domains pseudonymisiert, kein Feed/Panel).
# GUEST_MODE=true
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w server` then `cd server && npx tsc --noEmit`
Expected: all pass (new guest tests + updated auth asserts + everything prior), no type errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/.env.example server/test/app.test.ts
git commit -m "feat(server): guest role, /api/guest, anonymized guest stream"
```

---

## Task 3: Web auth-store role + guest

**Files:**
- Modify: `web/src/lib/auth/auth-store.ts`
- Test: `web/test/auth-store.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `web/test/auth-store.test.ts`:

(The file already imports `vi`, `get`, `afterEach(restoreAllMocks)`. Add `role`, `guestEnabled`, `loginAsGuest` to the import from `../src/lib/auth/auth-store.js`.)
```ts
  it("checkAuth reads role and guestEnabled from /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ authenticated: false, role: null, guestEnabled: true }),
    }));
    await checkAuth();
    expect(get(authed)).toBe(false);
    expect(get(role)).toBe(null);
    expect(get(guestEnabled)).toBe(true);
  });

  it("login sets role=user on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    await login("geheim");
    expect(get(role)).toBe("user");
  });

  it("loginAsGuest sets role=guest on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    expect(await loginAsGuest()).toBe(true);
    expect(get(authed)).toBe(true);
    expect(get(role)).toBe("guest");
  });

  it("loginAsGuest returns false on 404 and leaves role null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await loginAsGuest()).toBe(false);
    expect(get(role)).toBe(null);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — `role`/`guestEnabled`/`loginAsGuest` not exported.

- [ ] **Step 3: Implement** — rewrite `web/src/lib/auth/auth-store.ts`:
```ts
import { writable } from "svelte/store";

export type Role = "open" | "user" | "guest" | null;

/** null = noch unbekannt, true = eingeloggt/offen/gast, false = Login nötig. */
export const authed = writable<boolean | null>(null);
export const role = writable<Role>(null);
export const guestEnabled = writable<boolean>(false);

export async function checkAuth(): Promise<void> {
  try {
    const res = await fetch("/api/me");
    const data = (await res.json()) as { authenticated?: boolean; role?: Role; guestEnabled?: boolean };
    authed.set(!!data.authenticated);
    role.set(data.role ?? null);
    guestEnabled.set(!!data.guestEnabled);
  } catch {
    authed.set(false);
    role.set(null);
  }
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  authed.set(res.ok);
  if (res.ok) role.set("user");
  return res.ok;
}

export async function loginAsGuest(): Promise<boolean> {
  const res = await fetch("/api/guest", { method: "POST" });
  authed.set(res.ok);
  if (res.ok) role.set("guest");
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
  authed.set(false);
  role.set(null);
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -w web` then `cd web && npx tsc --noEmit`
Expected: PASS, no type errors (existing auth-store tests still pass).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/auth/auth-store.ts web/test/auth-store.test.ts
git commit -m "feat(web): role + guestEnabled stores and loginAsGuest"
```

---

## Task 4: Guest button in LoginOverlay

**Files:**
- Modify: `web/src/lib/auth/LoginOverlay.svelte`

(No unit test — presentational; verified by build.)

- [ ] **Step 1: Add the guest button.** In `web/src/lib/auth/LoginOverlay.svelte`:

Change the import line:
```svelte
  import { login } from "./auth-store.js";
```
to:
```svelte
  import { login, loginAsGuest, guestEnabled } from "./auth-store.js";
```
After the closing `</button>` of the "Anmelden" submit button (still inside the `<form>`), add:
```svelte
    {#if $guestEnabled}
      <button type="button" class="guest" onclick={() => loginAsGuest()}>Als Gast ansehen</button>
    {/if}
```
Add to the `<style>` block:
```css
  .guest {
    background: none; border: 1px solid var(--panel-border); border-radius: 8px;
    padding: 9px; font-size: 13px; color: var(--text-dim); cursor: pointer;
  }
  .guest:hover { color: var(--text); }
```

- [ ] **Step 2: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth/LoginOverlay.svelte
git commit -m "feat(web): guest button in login overlay"
```

---

## Task 5: Hide clients control + feed for guests

**Files:**
- Modify: `web/src/App.svelte`, `web/src/lib/hud/Hud.svelte`

- [ ] **Step 1: Pass `isGuest` from App.svelte.** In `web/src/App.svelte`:

Change the auth-store import:
```ts
  import { authed, checkAuth } from "./lib/auth/auth-store.js";
```
to:
```ts
  import { authed, role, checkAuth } from "./lib/auth/auth-store.js";
```
Change the Hud usage in the markup:
```svelte
<Hud getState={getGraph} onSelectClient={selectClientFromPanel} activeCount={activeClientCount} />
```
to:
```svelte
<Hud getState={getGraph} onSelectClient={selectClientFromPanel} activeCount={activeClientCount} isGuest={$role === "guest"} />
```

- [ ] **Step 2: Honor `isGuest` in Hud.svelte.** In `web/src/lib/hud/Hud.svelte`:

Extend the `Props` interface and destructure (add `isGuest`):
```ts
  interface Props {
    getState: () => GraphState;
    onSelectClient: (id: string) => void;
    activeCount: number;
    isGuest?: boolean;
  }
  let { getState, onSelectClient, activeCount, isGuest = false }: Props = $props();
```
Wrap the Clients button so guests don't see it — replace:
```svelte
    <button class="metric clients-btn" onclick={(e) => { e.stopPropagation(); toggleClientsPanel(); }}>
      <span class="label">Clients</span>
      <span class="value clients-value"><span class="counts"><span class="active-n">{activeCount}</span> / {$hud.clients}</span><span class="caret" class:open={$clientsPanelOpen}>▾</span></span>
    </button>
```
with:
```svelte
    {#if !isGuest}
      <button class="metric clients-btn" onclick={(e) => { e.stopPropagation(); toggleClientsPanel(); }}>
        <span class="label">Clients</span>
        <span class="value clients-value"><span class="counts"><span class="active-n">{activeCount}</span> / {$hud.clients}</span><span class="caret" class:open={$clientsPanelOpen}>▾</span></span>
      </button>
    {/if}
```
Gate the panel render too — replace `{#if $clientsPanelOpen}` with:
```svelte
  {#if $clientsPanelOpen && !isGuest}
```
Wrap the feed panel — replace the opening line of the feed panel:
```svelte
<div class="panel bottom-left feed">
```
by wrapping the WHOLE `<div class="panel bottom-left feed"> ... </div>` block in:
```svelte
{#if !isGuest}
<div class="panel bottom-left feed">
  ... (unchanged contents) ...
</div>
{/if}
```
(Only add the `{#if !isGuest}` before the opening `<div class="panel bottom-left feed">` and a matching `{/if}` after its closing `</div>` — do not change the feed's inner markup.)

- [ ] **Step 3: Typecheck, build, test**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.svelte web/src/lib/hud/Hud.svelte
git commit -m "feat(web): hide clients control + feed for guests"
```

---

## Task 6: Verify + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full suites + build**

Run: `npm test -w server` and `npm test -w web` and `cd web && npm run build`
Expected: server + web suites pass, build clean.

- [ ] **Step 2: Local QA (auth on + guest on)**

Temporarily set in `server/.env`: `DASHBOARD_PASSWORD=test123`, `SESSION_SECRET=localtest`, `GUEST_MODE=true`; let `dev:server` restart; open `http://localhost:5173`:
- The overlay shows **both** "Anmelden" and "Als Gast ansehen".
- Click guest → graph loads; the top-left **Clients** control is gone; the bottom-left **feed** is gone; the donut + Queries/Geblockt metrics remain.
- Open DevTools → Network → the `/events` stream: query lines contain `Client N` / `site-N`, **never** real device names or domains; no `clients` events.
Then REMOVE those three lines from `server/.env` again.

- [ ] **Step 3: Deploy to the Pi**

Per `deploy-pipeline` + `deploy-debugging-lessons` memory:
1. Merge to `main` first (finishing-a-development-branch).
2. **User** force-pushes the snapshot: `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force` (run from local `main`; confirm `git log --oneline -1` shows the latest guest-mode commit first).
3. **Before/after:** add `GUEST_MODE=true` to the Pi's root `~/pihole-viz/.env` (alongside `DASHBOARD_PASSWORD`/`SESSION_SECRET`).
4. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main`, then **confirm the feature is in the snapshot** (`git ls-tree -r origin/main --name-only | grep anonymize.ts`) BEFORE rebuilding, then `docker-compose up -d --build --force-recreate`.
5. Verify at `:8089`: overlay has the guest button; a guest session's `/events` payload is anonymized (`Client N`/`site-N`, no real names, no `clients` events); `/api/me` for a guest cookie → `role:"guest"`.

- [ ] **Step 4: Update CHANGELOG**

Add under `## [Unreleased]` → `### Added` in `CHANGELOG.md`:
```
- Guest mode: with GUEST_MODE=true (and a dashboard password set), the login
  overlay offers a passwordless "Als Gast ansehen" view. Guests see the live
  graph + aggregate stats, but client names/IPs and domains are anonymized
  server-side (stable Client N / site-N pseudonyms) and the clients panel +
  live feed are hidden.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for guest mode"
```

---

## Self-Review notes

- **Spec coverage:** anonymizer with stable pseudonyms + clients suppression + summary/status passthrough (Task 1); `GUEST_MODE` config (Task 1); `/api/guest` only when enabled, role-aware `requireAuth`, `/api/me` role+guestEnabled, anonymized guest `/events` (Task 2); auth-store `role`+`guestEnabled`+`loginAsGuest` (Task 3); overlay guest button (Task 4); App/Hud hide clients control + feed for guests (Task 5); deploy + GUEST_MODE on Pi (Task 6). ✓
- **Server-side enforcement (the architectural rule):** the anonymizer runs in `/events` before `writeSSE`; the guest browser never receives real identifiers, and `clients` events are dropped server-side. ✓
- **Non-breaking:** `guestMode?` optional on `AppDeps` (existing `createApp` callers default to off); the existing `/api/me` asserts are explicitly updated for the new `guestEnabled` field (Task 2 Step 1); open mode unchanged (`guestEnabled:false`, no anonymization, role read skipped when `!authEnabled`). ✓
- **Type consistency:** `Role = "open"|"user"|"guest"|null` (Task 3) matches server `/api/me` `role` values; `createAnonymizer()/anonymizeEvent` (Task 1) consumed in `app.ts` (Task 2); `isGuest` prop flows App→Hud (Task 5). `sessionRole` returns `"user"|"guest"|null` used by `requireAuth`, `/api/me`, `/events`. ✓
- **Known follow-up (out of scope):** guest password, logout button, keeping a connection indicator for guests (feed panel is hidden whole).
