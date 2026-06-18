# pihole-viz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lokale Web-App, die Pi-hole-v6-DNS-Traffic als Obsidian-artigen Live-Force-Graph (Clients ↔ Domains, geblockt = rot, 15-min-Sliding-Window) mit Floating-HUD visualisiert.

**Architecture:** npm-Workspaces-Monorepo mit drei Paketen: `shared` (zod-Schemas der SSE-Events), `server` (Hono-Proxy: hält Pi-hole-Passwort, pollt `/api/queries`, broadcastet per SSE), `web` (Vite + Svelte 5; pure GraphStore mit Decay → d3-force-Simulation → Pixi.js-WebGL-Renderer mit Glow; HUD als Svelte-Overlay).

**Tech Stack:** TypeScript, Hono + @hono/node-server, zod, tsx, Vite, Svelte 5, Pixi.js v8, d3-force, Vitest.

**Voraussetzungen:** Node ≥ 20.6. Pi-hole v6 erreichbar auf `http://pi.hole` (Tailscale). Für Task 7 wird ein Pi-hole-App-Passwort gebraucht (Webinterface → Settings → Web Interface / API → "Configure app password") — vorher vom User erfragen.

---

### Task 1: Monorepo-Gerüst

**Files:**
- Create: `package.json`, `shared/package.json`, `shared/tsconfig.json`, `server/package.json`, `server/tsconfig.json`, `web/package.json`, `web/tsconfig.json`

- [ ] **Step 1: Root `package.json` anlegen**

```json
{
  "name": "pihole-viz",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "dev:server": "npm run dev -w server",
    "dev:web": "npm run dev -w web",
    "build": "npm run build -w web"
  }
}
```

- [ ] **Step 2: `shared/package.json` anlegen**

```json
{
  "name": "@pihole-viz/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^3.0.0" },
  "scripts": { "test": "vitest run" }
}
```

- [ ] **Step 3: `shared/tsconfig.json` anlegen**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: `server/package.json` anlegen**

```json
{
  "name": "@pihole-viz/server",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@pihole-viz/shared": "*",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "start": "tsx --env-file=.env src/index.ts",
    "test": "vitest run"
  }
}
```

- [ ] **Step 5: `server/tsconfig.json` anlegen**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 6: `web/package.json` anlegen**

```json
{
  "name": "@pihole-viz/web",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@pihole-viz/shared": "*",
    "d3-force": "^3.0.0",
    "pixi.js": "^8.5.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@types/d3-force": "^3.0.0",
    "svelte": "^5.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  }
}
```

- [ ] **Step 7: `web/tsconfig.json` anlegen**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Installieren und verifizieren**

Run: `cd ~/dev/pihole-viz && npm install`
Expected: läuft durch, `node_modules/` existiert. (Hinweis: globale Supply-Chain-Guards des Users — release-age/ignore-scripts — sind aktiv; falls ein Paket wegen Mindestalter blockt, gepinnte ältere Minor-Version wählen.)

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json shared server web
git commit -m "chore: scaffold npm workspaces monorepo (shared/server/web)"
```

---

### Task 2: Shared Event-Schemas

**Files:**
- Create: `shared/src/index.ts`, `shared/src/events.ts`
- Test: `shared/test/events.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `shared/test/events.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { QueryEventSchema, ServerEventSchema } from "../src/index.js";

describe("event schemas", () => {
  const query = {
    type: "query",
    id: 42,
    time: 1760000000.5,
    domain: "ads.example.com",
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: true,
    status: "GRAVITY",
  };

  it("accepts a valid query event", () => {
    expect(QueryEventSchema.parse(query)).toEqual(query);
  });

  it("rejects a query event without domain", () => {
    const { domain: _domain, ...rest } = query;
    expect(QueryEventSchema.safeParse(rest).success).toBe(false);
  });

  it("discriminates the union by type", () => {
    const summary = {
      type: "summary",
      totalQueries: 100,
      blockedQueries: 18,
      percentBlocked: 18,
      activeClients: 5,
    };
    const status = { type: "status", state: "offline" };
    expect(ServerEventSchema.parse(summary)).toEqual(summary);
    expect(ServerEventSchema.parse(status)).toEqual(status);
    expect(ServerEventSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w shared`
Expected: FAIL — Modul `../src/index.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `shared/src/events.ts`

```ts
import { z } from "zod";

export const QueryEventSchema = z.object({
  type: z.literal("query"),
  id: z.number(),
  time: z.number(),
  domain: z.string().min(1),
  clientIp: z.string().min(1),
  clientName: z.string(),
  blocked: z.boolean(),
  status: z.string(),
});
export type QueryEvent = z.infer<typeof QueryEventSchema>;

export const SummaryEventSchema = z.object({
  type: z.literal("summary"),
  totalQueries: z.number(),
  blockedQueries: z.number(),
  percentBlocked: z.number(),
  activeClients: z.number(),
});
export type SummaryEvent = z.infer<typeof SummaryEventSchema>;

export const StatusEventSchema = z.object({
  type: z.literal("status"),
  state: z.enum(["online", "offline"]),
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
  QueryEventSchema,
  SummaryEventSchema,
  StatusEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
```

und `shared/src/index.ts`:

```ts
export * from "./events.js";
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npm test -w shared`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): add zod schemas for SSE wire events"
```

---

### Task 3: Server-Konfiguration

**Files:**
- Create: `server/src/config.ts`, `server/.env.example`
- Test: `server/test/config.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `server/test/config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const valid = {
    PIHOLE_URL: "http://pi.hole/",
    PIHOLE_PASSWORD: "secret",
  };

  it("loads config and strips trailing slash from URL", () => {
    const cfg = loadConfig(valid);
    expect(cfg).toEqual({
      piholeUrl: "http://pi.hole",
      piholePassword: "secret",
      pollIntervalMs: 2000,
      port: 5641,
    });
  });

  it("respects overrides", () => {
    const cfg = loadConfig({ ...valid, POLL_INTERVAL_MS: "500", PORT: "8000" });
    expect(cfg.pollIntervalMs).toBe(500);
    expect(cfg.port).toBe(8000);
  });

  it("fails fast when PIHOLE_URL is missing", () => {
    expect(() => loadConfig({ PIHOLE_PASSWORD: "x" })).toThrow(/PIHOLE_URL/);
  });

  it("fails fast when PIHOLE_PASSWORD is missing", () => {
    expect(() => loadConfig({ PIHOLE_URL: "http://x" })).toThrow(/PIHOLE_PASSWORD/);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w server`
Expected: FAIL — `../src/config.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `server/src/config.ts`

```ts
export interface Config {
  piholeUrl: string;
  piholePassword: string;
  pollIntervalMs: number;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const piholeUrl = env.PIHOLE_URL;
  if (!piholeUrl) {
    throw new Error("PIHOLE_URL fehlt — in server/.env setzen (siehe .env.example)");
  }
  const piholePassword = env.PIHOLE_PASSWORD;
  if (!piholePassword) {
    throw new Error("PIHOLE_PASSWORD fehlt — App-Passwort in server/.env setzen (siehe .env.example)");
  }
  return {
    piholeUrl: piholeUrl.replace(/\/+$/, ""),
    piholePassword,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 2000),
    port: Number(env.PORT ?? 5641),
  };
}
```

- [ ] **Step 4: `server/.env.example` anlegen**

```bash
# Pi-hole v6 Basis-URL (ohne /admin, ohne Slash am Ende)
PIHOLE_URL=http://pi.hole
# App-Passwort: Pi-hole Webinterface -> Settings -> Web Interface / API -> Configure app password
PIHOLE_PASSWORD=changeme
# Optional:
# POLL_INTERVAL_MS=2000
# PORT=5641
```

- [ ] **Step 5: Test laufen lassen — muss bestehen**

Run: `npm test -w server`
Expected: PASS (4 Tests)

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(server): add fail-fast env config loading"
```

---

### Task 4: Pi-hole API-Client (Auth + SID-Refresh)

**Files:**
- Create: `server/src/pihole-client.ts`
- Test: `server/test/pihole-client.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `server/test/pihole-client.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { PiholeClient } from "../src/pihole-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const AUTH_OK = { session: { valid: true, sid: "sid-1" } };

const QUERIES = {
  queries: [
    {
      id: 1,
      time: 1000.2,
      domain: "ads.example.com",
      status: "GRAVITY",
      client: { ip: "192.168.1.10", name: "iphone" },
    },
    {
      id: 2,
      time: 1001.0,
      domain: "api.spotify.com",
      status: "FORWARDED",
      client: { ip: "192.168.1.11", name: null },
    },
  ],
};

describe("PiholeClient", () => {
  it("authenticates once and maps queries to events", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(jsonResponse(200, QUERIES));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    const events = await client.fetchQueriesSince(999);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://pi/api/auth",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "http://pi/api/queries?from=999&length=1000",
      expect.objectContaining({ headers: { "X-FTL-SID": "sid-1" } }),
    );
    expect(events).toEqual([
      {
        type: "query",
        id: 1,
        time: 1000.2,
        domain: "ads.example.com",
        clientIp: "192.168.1.10",
        clientName: "iphone",
        blocked: true,
        status: "GRAVITY",
      },
      {
        type: "query",
        id: 2,
        time: 1001.0,
        domain: "api.spotify.com",
        clientIp: "192.168.1.11",
        clientName: "192.168.1.11",
        blocked: false,
        status: "FORWARDED",
      },
    ]);
  });

  it("re-authenticates once on 401 and retries", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { session: { valid: true, sid: "old" } }))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { session: { valid: true, sid: "new" } }))
      .mockResolvedValueOnce(jsonResponse(200, { queries: [] }));
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    const events = await client.fetchQueriesSince(0);

    expect(events).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/queries"),
      expect.objectContaining({ headers: { "X-FTL-SID": "new" } }),
    );
  });

  it("throws a clear error when auth fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const client = new PiholeClient("http://pi", "wrong", fetchFn);
    await expect(client.fetchQueriesSince(0)).rejects.toThrow(/Auth/);
  });

  it("maps the summary endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, AUTH_OK))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          queries: { total: 24613, blocked: 4530, percent_blocked: 18.4 },
          clients: { active: 14, total: 20 },
        }),
      );
    const client = new PiholeClient("http://pi", "pw", fetchFn);

    await expect(client.fetchSummary()).resolves.toEqual({
      type: "summary",
      totalQueries: 24613,
      blockedQueries: 4530,
      percentBlocked: 18.4,
      activeClients: 14,
    });
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w server`
Expected: FAIL — `../src/pihole-client.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `server/src/pihole-client.ts`

```ts
import type { QueryEvent, SummaryEvent } from "@pihole-viz/shared";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BLOCKED_STATUSES = new Set([
  "GRAVITY",
  "REGEX",
  "DENYLIST",
  "GRAVITY_CNAME",
  "REGEX_CNAME",
  "DENYLIST_CNAME",
  "EXTERNAL_BLOCKED_IP",
  "EXTERNAL_BLOCKED_NULL",
  "EXTERNAL_BLOCKED_NXRA",
  "EXTERNAL_BLOCKED_EDE15",
  "SPECIAL_DOMAIN",
]);

interface RawQuery {
  id: number;
  time: number;
  domain: string;
  status?: string | null;
  client?: { ip?: string | null; name?: string | null } | null;
}

export class PiholeClient {
  private sid: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private async authenticate(): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });
    if (!res.ok) {
      throw new Error(`Pi-hole Auth fehlgeschlagen (HTTP ${res.status}) — App-Passwort prüfen`);
    }
    const body = (await res.json()) as { session?: { valid?: boolean; sid?: string } };
    const sid = body.session?.valid ? body.session.sid : undefined;
    if (!sid) throw new Error("Pi-hole Auth: keine gültige Session erhalten");
    this.sid = sid;
    return sid;
  }

  private async request(path: string): Promise<unknown> {
    const sid = this.sid ?? (await this.authenticate());
    let res = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { "X-FTL-SID": sid },
    });
    if (res.status === 401) {
      this.sid = null;
      const fresh = await this.authenticate();
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { "X-FTL-SID": fresh },
      });
    }
    if (!res.ok) {
      throw new Error(`Pi-hole API ${path} antwortete HTTP ${res.status}`);
    }
    return res.json();
  }

  async fetchQueriesSince(fromSeconds: number): Promise<QueryEvent[]> {
    const data = (await this.request(
      `/api/queries?from=${Math.floor(fromSeconds)}&length=1000`,
    )) as { queries?: RawQuery[] };
    const queries = Array.isArray(data.queries) ? data.queries : [];
    return queries.map((q) => {
      const ip = q.client?.ip ?? "unknown";
      return {
        type: "query" as const,
        id: q.id,
        time: q.time,
        domain: q.domain,
        clientIp: ip,
        clientName: q.client?.name ?? ip,
        blocked: BLOCKED_STATUSES.has(q.status ?? ""),
        status: q.status ?? "UNKNOWN",
      };
    });
  }

  async fetchSummary(): Promise<SummaryEvent> {
    const data = (await this.request("/api/stats/summary")) as {
      queries?: { total?: number; blocked?: number; percent_blocked?: number };
      clients?: { active?: number };
    };
    return {
      type: "summary",
      totalQueries: data.queries?.total ?? 0,
      blockedQueries: data.queries?.blocked ?? 0,
      percentBlocked: data.queries?.percent_blocked ?? 0,
      activeClients: data.clients?.active ?? 0,
    };
  }

  async logout(): Promise<void> {
    if (!this.sid) return;
    await this.fetchFn(`${this.baseUrl}/api/auth`, {
      method: "DELETE",
      headers: { "X-FTL-SID": this.sid },
    }).catch(() => undefined);
    this.sid = null;
  }
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npm test -w server`
Expected: PASS (alle Tests, inkl. Task 3)

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): pi-hole v6 api client with sid auth and 401 refresh"
```

---

### Task 5: Query-Poller (Cursor, Dedupe, Backoff)

**Files:**
- Create: `server/src/poller.ts`
- Test: `server/test/poller.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `server/test/poller.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryEvent, ServerEvent } from "@pihole-viz/shared";
import { QueryPoller } from "../src/poller.js";

function q(id: number, time: number): QueryEvent {
  return {
    type: "query",
    id,
    time,
    domain: `d${id}.example.com`,
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: false,
    status: "FORWARDED",
  };
}

const SUMMARY = {
  type: "summary",
  totalQueries: 1,
  blockedQueries: 0,
  percentBlocked: 0,
  activeClients: 1,
} as const;

describe("QueryPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits new queries in time order and dedupes by id", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi
        .fn()
        .mockResolvedValueOnce([q(2, 1002), q(1, 1001)])
        .mockResolvedValueOnce([q(2, 1002), q(3, 1003)]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.filter((e) => e.type === "query").map((e) => (e as QueryEvent).id)).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(events.filter((e) => e.type === "query").map((e) => (e as QueryEvent).id)).toEqual([1, 2, 3]);
    poller.stop();
  });

  it("emits offline on failure, backs off, and emits online on recovery", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 100,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: "status", state: "offline" });

    // Backoff: nächster Versuch nach 2000ms, nicht 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.fetchQueriesSince).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: "status", state: "online" });
    poller.stop();
  });

  it("fetches summary every N polls", async () => {
    const events: ServerEvent[] = [];
    const client = {
      fetchQueriesSince: vi.fn().mockResolvedValue([]),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    };
    const poller = new QueryPoller({
      client,
      pollIntervalMs: 1000,
      summaryEveryNPolls: 2,
      onEvent: (e) => events.push(e),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // Poll 1 -> Summary
    await vi.advanceTimersByTimeAsync(1000); // Poll 2
    await vi.advanceTimersByTimeAsync(1000); // Poll 3 -> Summary
    expect(client.fetchSummary).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "summary")).toHaveLength(2);
    poller.stop();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w server`
Expected: FAIL — `../src/poller.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `server/src/poller.ts`

```ts
import type { QueryEvent, ServerEvent, SummaryEvent } from "@pihole-viz/shared";

export interface PollerClient {
  fetchQueriesSince(fromSeconds: number): Promise<QueryEvent[]>;
  fetchSummary(): Promise<SummaryEvent>;
}

export interface PollerOptions {
  client: PollerClient;
  pollIntervalMs: number;
  summaryEveryNPolls: number;
  onEvent: (event: ServerEvent) => void;
  nowSeconds?: () => number;
}

const CURSOR_OVERLAP_S = 5;
const MAX_SEEN_IDS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export class QueryPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly seenIds = new Set<number>();
  private lastTime: number;
  private failures = 0;
  private polls = 0;
  private online = true;
  private stopped = false;

  constructor(private readonly opts: PollerOptions) {
    const now = opts.nowSeconds?.() ?? Date.now() / 1000;
    this.lastTime = now - 60; // beim Start: letzte Minute anzeigen
  }

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    try {
      const events = await this.opts.client.fetchQueriesSince(this.lastTime - CURSOR_OVERLAP_S);
      const fresh = events
        .filter((e) => !this.seenIds.has(e.id))
        .sort((a, b) => a.time - b.time);
      for (const e of fresh) {
        this.seenIds.add(e.id);
        if (e.time > this.lastTime) this.lastTime = e.time;
        this.opts.onEvent(e);
      }
      this.pruneSeen();

      this.polls += 1;
      if (this.polls % this.opts.summaryEveryNPolls === 1) {
        this.opts.onEvent(await this.opts.client.fetchSummary());
      }

      if (!this.online) {
        this.online = true;
        this.opts.onEvent({ type: "status", state: "online" });
      }
      this.failures = 0;
      this.schedule(this.opts.pollIntervalMs);
    } catch (err) {
      this.failures += 1;
      if (this.online) {
        this.online = false;
        this.opts.onEvent({ type: "status", state: "offline" });
      }
      console.error(`[poller] Fehler (Versuch ${this.failures}):`, err);
      const backoff = Math.min(this.opts.pollIntervalMs * 2 ** this.failures, MAX_BACKOFF_MS);
      this.schedule(backoff);
    }
  }

  private pruneSeen(): void {
    if (this.seenIds.size <= MAX_SEEN_IDS) return;
    const excess = this.seenIds.size - MAX_SEEN_IDS;
    let i = 0;
    for (const id of this.seenIds) {
      if (i++ >= excess) break;
      this.seenIds.delete(id);
    }
  }
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npm test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): query poller with cursor, dedupe and exponential backoff"
```

---

### Task 6: Broadcaster + HTTP-App (SSE & Summary)

**Files:**
- Create: `server/src/broadcaster.ts`, `server/src/app.ts`
- Test: `server/test/broadcaster.test.ts`, `server/test/app.test.ts`

- [ ] **Step 1: Failing Tests schreiben** — `server/test/broadcaster.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { Broadcaster } from "../src/broadcaster.js";

describe("Broadcaster", () => {
  it("delivers events to all subscribers until unsubscribe", () => {
    const b = new Broadcaster();
    const a = vi.fn();
    const c = vi.fn();
    const unsubA = b.subscribe(a);
    b.subscribe(c);

    const event = { type: "status", state: "online" } as const;
    b.broadcast(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(c).toHaveBeenCalledWith(event);

    unsubA();
    b.broadcast(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(2);
  });
});
```

und `server/test/app.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Broadcaster } from "../src/broadcaster.js";
import { createApp } from "../src/app.js";

const SUMMARY = {
  type: "summary",
  totalQueries: 10,
  blockedQueries: 2,
  percentBlocked: 20,
  activeClients: 3,
} as const;

describe("createApp", () => {
  it("serves /api/summary from the pihole client", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    });
    const res = await app.request("/api/summary");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(SUMMARY);
  });

  it("returns 502 when pi-hole is unreachable", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(),
      fetchSummary: vi.fn().mockRejectedValue(new Error("down")),
    });
    const res = await app.request("/api/summary");
    expect(res.status).toBe(502);
  });

  it("streams broadcast events over /events as SSE", async () => {
    const broadcaster = new Broadcaster();
    const app = createApp({
      broadcaster,
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    });
    const res = await app.request("/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    broadcaster.broadcast({ type: "status", state: "online" });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"state":"online"');
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npm test -w server`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementieren** — `server/src/broadcaster.ts`

```ts
import type { ServerEvent } from "@pihole-viz/shared";

type Subscriber = (event: ServerEvent) => void;

export class Broadcaster {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  broadcast(event: ServerEvent): void {
    for (const fn of this.subscribers) fn(event);
  }
}
```

und `server/src/app.ts`:

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SummaryEvent } from "@pihole-viz/shared";
import type { Broadcaster } from "./broadcaster.js";

export interface AppDeps {
  broadcaster: Broadcaster;
  fetchSummary: () => Promise<SummaryEvent>;
}

const SSE_PING_INTERVAL_MS = 15_000;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

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

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npm test -w server`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): sse broadcaster and hono app with /events and /api/summary"
```

---

### Task 7: Server-Entry + Live-Check gegen echten Pi-hole

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Entry implementieren** — `server/src/index.ts`

```ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.js";
import { PiholeClient } from "./pihole-client.js";
import { QueryPoller } from "./poller.js";
import { Broadcaster } from "./broadcaster.js";
import { createApp } from "./app.js";

const config = loadConfig(process.env);
const client = new PiholeClient(config.piholeUrl, config.piholePassword);
const broadcaster = new Broadcaster();

const poller = new QueryPoller({
  client,
  pollIntervalMs: config.pollIntervalMs,
  summaryEveryNPolls: 5,
  onEvent: (event) => broadcaster.broadcast(event),
});

const app = createApp({ broadcaster, fetchSummary: () => client.fetchSummary() });
// Production: gebautes Frontend ausliefern (web/dist relativ zum Repo-Root)
app.use("/*", serveStatic({ root: "../web/dist" }));

poller.start();
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] läuft auf http://localhost:${info.port} → Pi-hole ${config.piholeUrl}`);
});

async function shutdown(): Promise<void> {
  console.log("[server] fahre herunter…");
  poller.stop();
  await client.logout(); // Pi-hole hat begrenzte Session-Slots
  server.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

- [ ] **Step 2: `.env` anlegen (mit echtem App-Passwort vom User)**

Den User nach dem App-Passwort fragen (Pi-hole Webinterface → Settings → Web Interface / API → "Configure app password"), dann:

```bash
cp server/.env.example server/.env
# PIHOLE_PASSWORD in server/.env eintragen (NIE committen — ist gitignored)
```

- [ ] **Step 3: Live-Verifikation**

Run: `npm run dev:server` (laufen lassen), dann in zweitem Terminal:

```bash
curl -s http://localhost:5641/api/summary
curl -sN --max-time 8 http://localhost:5641/events | head -20
```

Expected: Summary-JSON mit echten Zahlen; auf `/events` innerhalb weniger Sekunden `data: {"type":"query",...}`-Zeilen mit echten Domains. Falls 502/Auth-Fehler: Passwort und `PIHOLE_URL` prüfen.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire entry point with graceful shutdown and static hosting"
```

---

### Task 8: Web-Gerüst (Vite + Svelte 5 + Proxy + Basis-Styles)

**Files:**
- Create: `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/App.svelte`, `web/src/app.css`, `web/svelte.config.js`

- [ ] **Step 1: `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const SERVER = "http://localhost:5641";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/events": { target: SERVER, changeOrigin: true },
      "/api": { target: SERVER, changeOrigin: true },
    },
  },
});
```

- [ ] **Step 2: `web/svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
export default { preprocess: vitePreprocess() };
```

- [ ] **Step 3: `web/index.html`**

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>pihole-viz</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: `web/src/app.css`**

```css
:root {
  --bg: #0b0d12;
  --panel: rgba(22, 26, 34, 0.9);
  --panel-border: #2a3040;
  --text: #e8eaf0;
  --text-dim: #8b93a8;
  --client: #a89df8;
  --allowed: #86efac;
  --blocked: #fca5a5;
  font-family: -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
```

- [ ] **Step 5: `web/src/main.ts`**

```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });

export default app;
```

- [ ] **Step 6: Platzhalter-`web/src/App.svelte`** (wird in Task 13 ersetzt)

```svelte
<main class="stage">
  <p class="boot">pihole-viz lädt…</p>
</main>

<style>
  .stage { width: 100%; height: 100%; display: grid; place-items: center; }
  .boot { color: var(--text-dim); letter-spacing: 0.1em; }
</style>
```

- [ ] **Step 7: Verifizieren**

Run: `npm run dev:web` und `http://localhost:5173` öffnen.
Expected: dunkle Seite mit „pihole-viz lädt…", keine Konsolen-Fehler.

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(web): scaffold vite + svelte 5 shell with dev proxy and dark theme"
```

---

### Task 9: GraphStore (Sliding Window, Decay, Cap) — Kernlogik

**Files:**
- Create: `web/src/lib/graph/store.ts`
- Test: `web/test/graph-store.test.ts`

- [ ] **Step 1: Failing Tests schreiben** — `web/test/graph-store.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import {
  MAX_DOMAINS,
  WINDOW_MS,
  applyQuery,
  emptyGraph,
  tick,
} from "../src/lib/graph/store.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return {
    type: "query",
    id: Math.floor(Math.random() * 1e9),
    time: 0,
    domain,
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: false,
    status: "FORWARDED",
    ...opts,
  };
}

describe("GraphStore", () => {
  it("creates client node, domain node and edge for a query", () => {
    const g = applyQuery(emptyGraph(), q("a.com"), 1000);
    expect(g.nodes.get("client:192.168.1.10")).toMatchObject({
      kind: "client",
      label: "iphone",
      hits: 1,
    });
    expect(g.nodes.get("domain:a.com")).toMatchObject({
      kind: "domain",
      label: "a.com",
      blocked: false,
      hits: 1,
      lastSeen: 1000,
    });
    expect(g.edges.get("client:192.168.1.10->domain:a.com")).toMatchObject({ hits: 1 });
  });

  it("does not mutate the previous state (immutability)", () => {
    const g1 = applyQuery(emptyGraph(), q("a.com"), 1000);
    const g2 = applyQuery(g1, q("a.com"), 2000);
    expect(g1.nodes.get("domain:a.com")!.hits).toBe(1);
    expect(g2.nodes.get("domain:a.com")!.hits).toBe(2);
    expect(g2.nodes.get("domain:a.com")!.lastSeen).toBe(2000);
  });

  it("marks a domain blocked when any query for it was blocked", () => {
    let g = applyQuery(emptyGraph(), q("ads.com"), 1000);
    g = applyQuery(g, q("ads.com", { blocked: true }), 2000);
    expect(g.nodes.get("domain:ads.com")!.blocked).toBe(true);
  });

  it("decays opacity linearly and removes expired domains", () => {
    let g = applyQuery(emptyGraph(), q("a.com"), 0);
    g = tick(g, WINDOW_MS / 2);
    expect(g.nodes.get("domain:a.com")!.opacity).toBeCloseTo(0.5, 1);
    g = tick(g, WINDOW_MS + 1000);
    expect(g.nodes.has("domain:a.com")).toBe(false);
    // Client ohne verbleibende Kanten verschwindet mit
    expect(g.nodes.has("client:192.168.1.10")).toBe(false);
    expect(g.edges.size).toBe(0);
  });

  it("evicts oldest domains above MAX_DOMAINS and reports the drop count", () => {
    let g = emptyGraph();
    for (let i = 0; i < MAX_DOMAINS + 10; i++) {
      g = applyQuery(g, q(`d${i}.com`), i);
    }
    g = tick(g, MAX_DOMAINS + 10);
    const domainCount = [...g.nodes.values()].filter((n) => n.kind === "domain").length;
    expect(domainCount).toBe(MAX_DOMAINS);
    expect(g.nodes.has("domain:d0.com")).toBe(false); // ältester flog raus
    expect(g.nodes.has(`domain:d${MAX_DOMAINS + 9}.com`)).toBe(true);
    expect(g.droppedDomains).toBe(10);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `npm test -w web`
Expected: FAIL — `store.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `web/src/lib/graph/store.ts`

```ts
import type { QueryEvent } from "@pihole-viz/shared";

export const WINDOW_MS = 15 * 60_000;
export const MAX_DOMAINS = 400;

export interface GraphNode {
  id: string;
  kind: "client" | "domain";
  label: string;
  blocked: boolean;
  hits: number;
  lastSeen: number;
  opacity: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  hits: number;
  lastSeen: number;
  blocked: boolean;
}

export interface GraphState {
  nodes: ReadonlyMap<string, GraphNode>;
  edges: ReadonlyMap<string, GraphEdge>;
  droppedDomains: number;
}

export function emptyGraph(): GraphState {
  return { nodes: new Map(), edges: new Map(), droppedDomains: 0 };
}

export function clientId(ip: string): string {
  return `client:${ip}`;
}

export function domainId(domain: string): string {
  return `domain:${domain}`;
}

export function applyQuery(state: GraphState, query: QueryEvent, now: number): GraphState {
  const cId = clientId(query.clientIp);
  const dId = domainId(query.domain);
  const eId = `${cId}->${dId}`;

  const nodes = new Map(state.nodes);
  const edges = new Map(state.edges);

  const client = nodes.get(cId);
  nodes.set(cId, {
    id: cId,
    kind: "client",
    label: query.clientName,
    blocked: false,
    hits: (client?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
  });

  const domain = nodes.get(dId);
  nodes.set(dId, {
    id: dId,
    kind: "domain",
    label: query.domain,
    blocked: (domain?.blocked ?? false) || query.blocked,
    hits: (domain?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
  });

  const edge = edges.get(eId);
  edges.set(eId, {
    id: eId,
    source: cId,
    target: dId,
    hits: (edge?.hits ?? 0) + 1,
    lastSeen: now,
    blocked: query.blocked,
  });

  return { nodes, edges, droppedDomains: state.droppedDomains };
}

export function tick(state: GraphState, now: number): GraphState {
  const nodes = new Map<string, GraphNode>();
  let dropped = state.droppedDomains;

  // 1. Decay & Window: Domains verblassen, abgelaufene fliegen raus
  for (const node of state.nodes.values()) {
    const age = now - node.lastSeen;
    const opacity = Math.max(0, 1 - age / WINDOW_MS);
    if (node.kind === "domain" && opacity <= 0) continue;
    nodes.set(node.id, { ...node, opacity: node.kind === "client" ? 1 : opacity });
  }

  // 2. Cap: über MAX_DOMAINS hinaus älteste Domains entfernen
  const domains = [...nodes.values()]
    .filter((n) => n.kind === "domain")
    .sort((a, b) => a.lastSeen - b.lastSeen);
  if (domains.length > MAX_DOMAINS) {
    for (const evictee of domains.slice(0, domains.length - MAX_DOMAINS)) {
      nodes.delete(evictee.id);
      dropped += 1;
    }
  }

  // 3. Kanten ohne beide Endpunkte entfernen
  const edges = new Map<string, GraphEdge>();
  for (const edge of state.edges.values()) {
    if (nodes.has(edge.source) && nodes.has(edge.target)) edges.set(edge.id, edge);
  }

  // 4. Clients ohne Kanten entfernen
  const connected = new Set<string>();
  for (const edge of edges.values()) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  for (const node of nodes.values()) {
    if (node.kind === "client" && !connected.has(node.id)) nodes.delete(node.id);
  }

  return { nodes, edges, droppedDomains: dropped };
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npm test -w web`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): immutable graph store with sliding window decay and domain cap"
```

---

### Task 10: SSE-Stream-Client

**Files:**
- Create: `web/src/lib/stream.ts`
- Test: `web/test/stream.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `web/test/stream.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { connectStream } from "../src/lib/stream.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("connectStream", () => {
  it("parses valid events, drops invalid ones, reports connection state", () => {
    const onEvent = vi.fn();
    const onConnectionChange = vi.fn();
    const disconnect = connectStream(
      "/events",
      { onEvent, onConnectionChange },
      (url) => new FakeEventSource(url) as unknown as EventSource,
    );

    const es = FakeEventSource.instances.at(-1)!;
    es.onopen!();
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    es.onmessage!({ data: JSON.stringify({ type: "status", state: "online" }) });
    expect(onEvent).toHaveBeenCalledWith({ type: "status", state: "online" });

    es.onmessage!({ data: "not json" });
    es.onmessage!({ data: JSON.stringify({ type: "garbage" }) });
    expect(onEvent).toHaveBeenCalledTimes(1);

    es.onerror!();
    expect(onConnectionChange).toHaveBeenCalledWith(false);

    disconnect();
    expect(es.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w web`
Expected: FAIL — `stream.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `web/src/lib/stream.ts`

```ts
import { ServerEventSchema, type ServerEvent } from "@pihole-viz/shared";

export interface StreamHandlers {
  onEvent: (event: ServerEvent) => void;
  onConnectionChange: (connected: boolean) => void;
}

type EventSourceFactory = (url: string) => EventSource;

export function connectStream(
  url: string,
  handlers: StreamHandlers,
  createEventSource: EventSourceFactory = (u) => new EventSource(u),
): () => void {
  const source = createEventSource(url);

  source.onopen = () => handlers.onConnectionChange(true);
  source.onerror = () => handlers.onConnectionChange(false); // EventSource reconnectet selbst

  source.onmessage = (message) => {
    let raw: unknown;
    try {
      raw = JSON.parse(message.data);
    } catch {
      console.warn("[stream] verworfen: kein JSON", message.data);
      return;
    }
    const parsed = ServerEventSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[stream] verworfen: Schema-Fehler", parsed.error.issues);
      return;
    }
    handlers.onEvent(parsed.data);
  };

  return () => source.close();
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npm test -w web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): sse stream client with zod validation and injectable EventSource"
```

---

### Task 11: Renderer — Farben, Glow-Texturen, Simulation, Pixi

Rendering-Code ist nicht unit-testbar (WebGL) — Verifikation erfolgt manuell in Task 13. Sorgfältig implementieren, Logik die testbar wäre (Größenformeln) bleibt in puren Funktionen.

**Files:**
- Create: `web/src/lib/render/colors.ts`, `web/src/lib/render/sizes.ts`, `web/src/lib/render/textures.ts`, `web/src/lib/render/simulation.ts`, `web/src/lib/render/renderer.ts`
- Test: `web/test/sizes.test.ts`

- [ ] **Step 1: `web/src/lib/render/colors.ts`**

```ts
export const COLORS = {
  background: 0x0b0d12,
  client: 0xa89df8,
  clientGlow: 0x8b7cf8,
  domainAllowed: 0x86efac,
  domainAllowedGlow: 0x4ade80,
  domainBlocked: 0xfca5a5,
  domainBlockedGlow: 0xf87171,
  edge: 0x2d3344,
  edgeBlockedPulse: 0xf87171,
  labelClient: 0xc4bdfb,
  labelDomain: 0x8b93a8,
} as const;
```

- [ ] **Step 2: Größenformeln testgetrieben** — Test `web/test/sizes.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { domainRadius, clientRadius } from "../src/lib/render/sizes.js";

describe("node sizes", () => {
  it("grows logarithmically with hits and is capped", () => {
    expect(domainRadius(1)).toBeCloseTo(5);
    expect(domainRadius(10)).toBeGreaterThan(domainRadius(1));
    expect(domainRadius(100000)).toBeLessThanOrEqual(16);
    expect(clientRadius(1)).toBeCloseTo(10);
    expect(clientRadius(100000)).toBeLessThanOrEqual(26);
  });
});
```

Run: `npm test -w web` → Expected: FAIL. Dann `web/src/lib/render/sizes.ts`:

```ts
export function domainRadius(hits: number): number {
  return Math.min(5 + Math.log2(Math.max(1, hits)) * 1.5, 16);
}

export function clientRadius(hits: number): number {
  return Math.min(10 + Math.log2(Math.max(1, hits)) * 1.5, 26);
}
```

Run: `npm test -w web` → Expected: PASS.

- [ ] **Step 3: `web/src/lib/render/textures.ts`**

```ts
import { Texture } from "pixi.js";

function radialTexture(stops: Array<[number, string]>, size: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/** Weicher Halo — wird per Tint eingefärbt, blendMode "add". */
export function createGlowTexture(): Texture {
  return radialTexture(
    [
      [0, "rgba(255,255,255,0.85)"],
      [0.3, "rgba(255,255,255,0.25)"],
      [1, "rgba(255,255,255,0)"],
    ],
    128,
  );
}

/** Fester Kern mit minimal weicher Kante. */
export function createCoreTexture(): Texture {
  return radialTexture(
    [
      [0, "rgba(255,255,255,1)"],
      [0.85, "rgba(255,255,255,1)"],
      [1, "rgba(255,255,255,0)"],
    ],
    64,
  );
}
```

- [ ] **Step 4: `web/src/lib/render/simulation.ts`**

```ts
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphState } from "../graph/store.js";

export interface SimNode extends SimulationNodeDatum {
  id: string;
}

type SimLink = SimulationLinkDatum<SimNode> & { id: string };

export class GraphSimulation {
  private readonly sim: Simulation<SimNode, SimLink>;
  private readonly byId = new Map<string, SimNode>();
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];

  constructor(private width: number, private height: number) {
    this.sim = forceSimulation<SimNode>([])
      .force("charge", forceManyBody().strength(-90))
      .force(
        "link",
        forceLink<SimNode, SimLink>([]).id((d) => d.id).distance(70).strength(0.35),
      )
      .force("collide", forceCollide(16))
      .force("center", forceCenter(width / 2, height / 2).strength(0.04))
      .alphaDecay(0.028)
      .stop();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sim.force("center", forceCenter(width / 2, height / 2).strength(0.04));
  }

  /** Sim-Knoten mit dem Store abgleichen; bestehende behalten ihre Position. */
  sync(state: GraphState): void {
    let changed = false;

    for (const id of this.byId.keys()) {
      if (!state.nodes.has(id)) {
        this.byId.delete(id);
        changed = true;
      }
    }

    for (const node of state.nodes.values()) {
      if (!this.byId.has(node.id)) {
        // Neue Domains starten nahe einem verbundenen Client (weniger Springen)
        const edge = [...state.edges.values()].find((e) => e.target === node.id);
        const anchor = edge ? this.byId.get(edge.source) : undefined;
        const jitter = () => (Math.random() - 0.5) * 60;
        this.byId.set(node.id, {
          id: node.id,
          x: (anchor?.x ?? this.width / 2) + jitter(),
          y: (anchor?.y ?? this.height / 2) + jitter(),
        });
        changed = true;
      }
    }

    const prevLinkCount = this.links.length;
    this.nodes = [...this.byId.values()];
    this.links = [...state.edges.values()].map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));

    this.sim.nodes(this.nodes);
    (this.sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(this.links);

    if (changed || this.links.length !== prevLinkCount) {
      this.sim.alpha(0.5);
    }
  }

  /** Einen Physik-Schritt rechnen (vom Pixi-Ticker aufgerufen). */
  step(): void {
    if (this.sim.alpha() > this.sim.alphaMin()) this.sim.tick();
  }

  position(id: string): { x: number; y: number } | undefined {
    const node = this.byId.get(id);
    return node ? { x: node.x ?? 0, y: node.y ?? 0 } : undefined;
  }
}
```

- [ ] **Step 5: `web/src/lib/render/renderer.ts`**

```ts
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { GraphState } from "../graph/store.js";
import { GraphSimulation } from "./simulation.js";
import { createCoreTexture, createGlowTexture } from "./textures.js";
import { clientRadius, domainRadius } from "./sizes.js";
import { COLORS } from "./colors.js";

interface NodeVisual {
  root: Container;
  glow: Sprite;
  core: Sprite;
  label: Text;
  pulse: number;
  lastHits: number;
}

export interface RendererCallbacks {
  onHover?: (nodeId: string | null, x: number, y: number) => void;
  onTap?: (nodeId: string) => void;
}

export class GraphRenderer {
  private app!: Application;
  private world!: Container;
  private edgeGfx!: Graphics;
  private nodeLayer!: Container;
  private sim!: GraphSimulation;
  private glowTexture!: Texture;
  private coreTexture!: Texture;
  private readonly visuals = new Map<string, NodeVisual>();
  private state: GraphState | null = null;
  private highlightId: string | null = null;

  constructor(private readonly callbacks: RendererCallbacks = {}) {}

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: COLORS.background,
      resizeTo: container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(this.app.canvas);

    this.world = new Container();
    this.edgeGfx = new Graphics();
    this.nodeLayer = new Container();
    this.world.addChild(this.edgeGfx, this.nodeLayer);
    this.app.stage.addChild(this.world);

    this.glowTexture = createGlowTexture();
    this.coreTexture = createCoreTexture();
    this.sim = new GraphSimulation(this.app.screen.width, this.app.screen.height);

    this.app.renderer.on("resize", (w: number, h: number) => this.sim.resize(w, h));
    this.app.ticker.add(() => this.frame());
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get worldContainer(): Container {
    return this.world;
  }

  update(state: GraphState): void {
    this.state = state;
    this.sim.sync(state);
    this.syncVisuals(state);
  }

  setHighlight(id: string | null): void {
    this.highlightId = id;
  }

  private nodeColors(blocked: boolean, kind: "client" | "domain") {
    if (kind === "client") return { core: COLORS.client, glow: COLORS.clientGlow };
    return blocked
      ? { core: COLORS.domainBlocked, glow: COLORS.domainBlockedGlow }
      : { core: COLORS.domainAllowed, glow: COLORS.domainAllowedGlow };
  }

  private syncVisuals(state: GraphState): void {
    for (const [id, visual] of this.visuals) {
      if (!state.nodes.has(id)) {
        visual.root.destroy({ children: true });
        this.visuals.delete(id);
      }
    }

    for (const node of state.nodes.values()) {
      let visual = this.visuals.get(node.id);
      if (!visual) {
        const root = new Container();
        const glow = new Sprite(this.glowTexture);
        glow.anchor.set(0.5);
        glow.blendMode = "add";
        const core = new Sprite(this.coreTexture);
        core.anchor.set(0.5);
        const label = new Text({
          text: node.label,
          style: {
            fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
            fontSize: node.kind === "client" ? 13 : 10,
            fill: node.kind === "client" ? COLORS.labelClient : COLORS.labelDomain,
          },
        });
        label.anchor.set(0.5, -0.9);
        root.addChild(glow, core, label);
        root.eventMode = "static";
        root.cursor = "pointer";
        root.on("pointerover", (e) =>
          this.callbacks.onHover?.(node.id, e.global.x, e.global.y),
        );
        root.on("pointerout", () => this.callbacks.onHover?.(null, 0, 0));
        root.on("pointertap", () => this.callbacks.onTap?.(node.id));
        this.nodeLayer.addChild(root);
        visual = { root, glow, core, label, pulse: 0, lastHits: 0 };
        this.visuals.set(node.id, visual);
      }

      if (node.hits > visual.lastHits) {
        visual.pulse = 1; // neue Query → aufleuchten
        visual.lastHits = node.hits;
      }

      const { core, glow } = this.nodeColors(node.blocked, node.kind);
      visual.core.tint = core;
      visual.glow.tint = glow;
      visual.label.text = node.label;
    }
  }

  private neighborhood(id: string): Set<string> {
    const keep = new Set([id]);
    if (!this.state) return keep;
    for (const edge of this.state.edges.values()) {
      if (edge.source === id) keep.add(edge.target);
      if (edge.target === id) keep.add(edge.source);
    }
    return keep;
  }

  private frame(): void {
    if (!this.state) return;
    this.sim.step();

    const highlight = this.highlightId ? this.neighborhood(this.highlightId) : null;

    this.edgeGfx.clear();
    for (const edge of this.state.edges.values()) {
      const a = this.sim.position(edge.source);
      const b = this.sim.position(edge.target);
      if (!a || !b) continue;
      const target = this.state.nodes.get(edge.target);
      const sourceVisual = this.visuals.get(edge.target);
      const pulse = sourceVisual?.pulse ?? 0;
      const dimmed = highlight !== null && !(highlight.has(edge.source) && highlight.has(edge.target));
      const baseAlpha = Math.min(0.5, 0.15 + (target?.opacity ?? 0) * 0.35) * (dimmed ? 0.15 : 1);
      this.edgeGfx.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
        width: 1 + Math.min(edge.hits, 8) * 0.15 + pulse,
        color: edge.blocked && pulse > 0.05 ? COLORS.edgeBlockedPulse : COLORS.edge,
        alpha: baseAlpha + pulse * 0.4,
      });
    }

    for (const node of this.state.nodes.values()) {
      const visual = this.visuals.get(node.id);
      const pos = this.sim.position(node.id);
      if (!visual || !pos) continue;
      visual.pulse = Math.max(0, visual.pulse - 0.03);

      const radius = node.kind === "client" ? clientRadius(node.hits) : domainRadius(node.hits);
      const scale = 1 + visual.pulse * 0.5;
      visual.root.position.set(pos.x, pos.y);
      visual.core.width = visual.core.height = radius * 2 * scale;
      visual.glow.width = visual.glow.height = radius * 7 * scale;
      visual.glow.alpha = 0.55 + visual.pulse * 0.45;

      const dimmed = highlight !== null && !highlight.has(node.id);
      visual.root.alpha = node.opacity * (dimmed ? 0.12 : 1);

      const worldScale = this.world.scale.x;
      visual.label.alpha =
        node.kind === "client" ? 1 : worldScale > 1.4 || visual.pulse > 0.3 ? 0.9 : 0;
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
```

- [ ] **Step 6: Type-Check + Tests**

Run: `npx tsc -p web/tsconfig.json && npm test -w web`
Expected: keine TS-Fehler, Tests PASS.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(web): pixi webgl renderer with glow sprites, pulses and d3-force simulation"
```

---

### Task 12: Pan/Zoom + Interaktion

**Files:**
- Create: `web/src/lib/render/panzoom.ts`

- [ ] **Step 1: Implementieren** — `web/src/lib/render/panzoom.ts`

```ts
import type { Container } from "pixi.js";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** Wheel-Zoom um den Mauszeiger + Drag-Pan. Gibt eine Cleanup-Funktion zurück. */
export function attachPanZoom(canvas: HTMLCanvasElement, world: Container): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, world.scale.x * factor));
    const applied = next / world.scale.x;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    world.x = px - (px - world.x) * applied;
    world.y = py - (py - world.y) * applied;
    world.scale.set(next);
  };

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    world.x += e.clientX - lastX;
    world.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onUp = (e: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return () => {
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
  };
}
```

- [ ] **Step 2: Type-Check**

Run: `npx tsc -p web/tsconfig.json`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add web
git commit -m "feat(web): manual pan/zoom on pixi world container"
```

---

### Task 13: HUD + App-Verdrahtung

**Files:**
- Create: `web/src/lib/hud/hud-store.ts`, `web/src/lib/hud/Hud.svelte`
- Modify: `web/src/App.svelte` (Platzhalter aus Task 8 ersetzen)
- Test: `web/test/hud-store.test.ts`

- [ ] **Step 1: Failing Test schreiben** — `web/test/hud-store.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { FEED_LIMIT, applyServerEvent, hud, resetHud } from "../src/lib/hud/hud-store.js";

describe("hud store", () => {
  beforeEach(() => resetHud());

  it("updates counters from summary events", () => {
    applyServerEvent({
      type: "summary",
      totalQueries: 100,
      blockedQueries: 25,
      percentBlocked: 25,
      activeClients: 7,
    });
    expect(get(hud)).toMatchObject({ total: 100, blocked: 25, percent: 25, clients: 7 });
  });

  it("prepends feed items and caps the feed", () => {
    for (let i = 0; i < FEED_LIMIT + 3; i++) {
      applyServerEvent({
        type: "query",
        id: i,
        time: i,
        domain: `d${i}.com`,
        clientIp: "ip",
        clientName: "mac",
        blocked: i % 2 === 0,
        status: "GRAVITY",
      });
    }
    const { feed } = get(hud);
    expect(feed).toHaveLength(FEED_LIMIT);
    expect(feed[0].domain).toBe(`d${FEED_LIMIT + 2}.com`);
  });

  it("tracks connection status events", () => {
    applyServerEvent({ type: "status", state: "offline" });
    expect(get(hud).connected).toBe(false);
    applyServerEvent({ type: "status", state: "online" });
    expect(get(hud).connected).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npm test -w web`
Expected: FAIL — `hud-store.js` nicht gefunden.

- [ ] **Step 3: Implementieren** — `web/src/lib/hud/hud-store.ts`

```ts
import { writable } from "svelte/store";
import type { ServerEvent } from "@pihole-viz/shared";

export const FEED_LIMIT = 8;

export interface FeedItem {
  id: number;
  domain: string;
  clientName: string;
  blocked: boolean;
}

export interface HudState {
  total: number;
  blocked: number;
  percent: number;
  clients: number;
  feed: FeedItem[];
  connected: boolean;
}

const initial: HudState = {
  total: 0,
  blocked: 0,
  percent: 0,
  clients: 0,
  feed: [],
  connected: true,
};

export const hud = writable<HudState>(initial);

export function resetHud(): void {
  hud.set(initial);
}

export function applyServerEvent(event: ServerEvent): void {
  hud.update((state) => {
    switch (event.type) {
      case "summary":
        return {
          ...state,
          total: event.totalQueries,
          blocked: event.blockedQueries,
          percent: event.percentBlocked,
          clients: event.activeClients,
        };
      case "query":
        return {
          ...state,
          feed: [
            {
              id: event.id,
              domain: event.domain,
              clientName: event.clientName,
              blocked: event.blocked,
            },
            ...state.feed,
          ].slice(0, FEED_LIMIT),
        };
      case "status":
        return { ...state, connected: event.state === "online" };
    }
  });
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npm test -w web`
Expected: PASS

- [ ] **Step 5: `web/src/lib/hud/Hud.svelte`**

```svelte
<script lang="ts">
  import { hud } from "./hud-store.js";

  const CIRCUMFERENCE = 2 * Math.PI * 26;
  let dash = $derived((($hud.percent ?? 0) / 100) * CIRCUMFERENCE);
</script>

<div class="panel top-left">
  <div class="metric">
    <span class="label">Queries heute</span>
    <span class="value">{$hud.total.toLocaleString("de-DE")}</span>
  </div>
  <div class="metric">
    <span class="label">Geblockt</span>
    <span class="value blocked">{$hud.blocked.toLocaleString("de-DE")}</span>
  </div>
  <div class="metric">
    <span class="label">Clients</span>
    <span class="value">{$hud.clients}</span>
  </div>
</div>

<div class="panel top-right gauge">
  <svg viewBox="0 0 64 64" width="64" height="64">
    <circle cx="32" cy="32" r="26" fill="none" stroke="#2a3040" stroke-width="6" />
    <circle
      cx="32" cy="32" r="26" fill="none"
      stroke="#f87171" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="{dash} {CIRCUMFERENCE}"
      transform="rotate(-90 32 32)"
    />
  </svg>
  <div class="gauge-text">
    <span class="value">{$hud.percent.toFixed(1)}%</span>
    <span class="label">Block-Rate</span>
  </div>
</div>

<div class="panel bottom-left feed">
  <span class="label">Live</span>
  <ul>
    {#each $hud.feed as item (item.id)}
      <li class:blocked={item.blocked}>
        <span class="domain">{item.domain}</span>
        <span class="client">{item.clientName}</span>
      </li>
    {/each}
  </ul>
</div>

<div class="panel bottom-right status" class:offline={!$hud.connected}>
  <span class="dot"></span>
  {$hud.connected ? "verbunden" : "offline — reconnecting"}
</div>

<style>
  .panel {
    position: fixed;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    padding: 12px 16px;
    backdrop-filter: blur(8px);
    pointer-events: none;
    z-index: 10;
  }
  .top-left { top: 16px; left: 16px; display: flex; gap: 24px; }
  .top-right { top: 16px; right: 16px; }
  .bottom-left { bottom: 16px; left: 16px; min-width: 280px; }
  .bottom-right { bottom: 16px; right: 16px; font-size: 12px; color: var(--text-dim); }

  .metric { display: flex; flex-direction: column; gap: 2px; }
  .label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }
  .value { font-size: 20px; font-variant-numeric: tabular-nums; }
  .value.blocked { color: var(--blocked); }

  .gauge { display: flex; align-items: center; gap: 12px; }
  .gauge-text { display: flex; flex-direction: column; }
  .gauge-text .value { font-size: 18px; }

  .feed ul { list-style: none; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
  .feed li {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
    color: var(--allowed);
  }
  .feed li.blocked { color: var(--blocked); text-decoration: line-through; }
  .feed .client { color: var(--text-dim); text-decoration: none; }

  .status { display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--allowed); }
  .status.offline .dot { background: var(--blocked); animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: 0.3; } }
</style>
```

- [ ] **Step 6: `web/src/App.svelte` ersetzen**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { SummaryEventSchema } from "@pihole-viz/shared";
  import Hud from "./lib/hud/Hud.svelte";
  import { connectStream } from "./lib/stream.js";
  import { applyQuery, emptyGraph, tick } from "./lib/graph/store.js";
  import { GraphRenderer } from "./lib/render/renderer.js";
  import { attachPanZoom } from "./lib/render/panzoom.js";
  import { applyServerEvent } from "./lib/hud/hud-store.js";

  let container: HTMLDivElement;
  let tooltip = $state<{ text: string; x: number; y: number } | null>(null);
  let hiddenDomains = $state(0);
  let highlighted: string | null = null;

  onMount(() => {
    let graph = emptyGraph();
    let disconnect: (() => void) | undefined;
    let detachPanZoom: (() => void) | undefined;

    const renderer = new GraphRenderer({
      onHover(nodeId, x, y) {
        tooltip = nodeId ? { text: nodeId.replace(/^(client|domain):/, ""), x, y } : null;
      },
      onTap(nodeId) {
        highlighted = highlighted === nodeId ? null : nodeId;
        renderer.setHighlight(highlighted);
      },
    });

    void renderer.init(container).then(() => {
      detachPanZoom = attachPanZoom(renderer.canvas, renderer.worldContainer);
      disconnect = connectStream("/events", {
        onEvent(event) {
          applyServerEvent(event);
          if (event.type === "query") {
            graph = applyQuery(graph, event, Date.now());
            renderer.update(graph);
          }
        },
        onConnectionChange(connected) {
          applyServerEvent({ type: "status", state: connected ? "online" : "offline" });
        },
      });
    });

    // Initiale Summary, damit das HUD nicht bei 0 startet
    void fetch("/api/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        const parsed = SummaryEventSchema.safeParse(raw);
        if (parsed.success) applyServerEvent(parsed.data);
      })
      .catch(() => undefined);

    const decayTimer = setInterval(() => {
      graph = tick(graph, Date.now());
      hiddenDomains = graph.droppedDomains;
      renderer.update(graph);
    }, 1000);

    return () => {
      clearInterval(decayTimer);
      disconnect?.();
      detachPanZoom?.();
      renderer.destroy();
    };
  });
</script>

<div class="stage" bind:this={container}></div>
{#if tooltip}
  <div class="tooltip" style="left: {tooltip.x + 14}px; top: {tooltip.y + 14}px">
    {tooltip.text}
  </div>
{/if}
{#if hiddenDomains > 0}
  <div class="cap-notice">{hiddenDomains} ältere Domains ausgeblendet (Limit 400)</div>
{/if}
<Hud />

<style>
  .stage { width: 100%; height: 100%; }
  .cap-notice {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--text-dim);
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 3px 10px;
    z-index: 10;
  }
  .tooltip {
    position: fixed;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
    pointer-events: none;
    z-index: 20;
  }
</style>
```

- [ ] **Step 7: Alles testen + Type-Check**

Run: `npm test && npx tsc -p web/tsconfig.json`
Expected: alle Tests PASS, keine TS-Fehler.

- [ ] **Step 8: Manuelle End-to-End-Verifikation (Live-Smoke-Test)**

Run: `npm run dev:server` und `npm run dev:web` parallel, `http://localhost:5173` öffnen.
Checkliste:
- Dunkler Screen, innerhalb ~5 s erscheinen leuchtende Knoten (lila Clients, grüne/rote Domains)
- Neue Queries lassen Knoten aufpulsen; HUD-Feed läuft mit
- Geblockte Domains rot, im Feed durchgestrichen
- Zoom (Wheel) und Pan (Drag) funktionieren; ab Zoom > 1.4 erscheinen Domain-Labels
- Klick auf Client dimmt den Rest; zweiter Klick hebt es auf
- Block-Rate-Ring zeigt plausible Prozentzahl
- Server stoppen → Status-Panel wird rot „offline"; Server starten → wieder grün

- [ ] **Step 9: Commit**

```bash
git add web
git commit -m "feat(web): floating hud and app wiring for live graph"
```

---

### Task 14: README + Abschluss

**Files:**
- Create: `README.md`

- [ ] **Step 1: `README.md` schreiben**

```markdown
# pihole-viz

Obsidian-artiger Live-Graph für Pi-hole v6: Clients ↔ Domains als leuchtendes
Netz, geblockte Domains rot, 15-Minuten-Sliding-Window, Floating-HUD mit
Block-Rate und Live-Feed.

## Setup

1. App-Passwort im Pi-hole erzeugen: Settings → Web Interface / API →
   "Configure app password"
2. `cp server/.env.example server/.env` und `PIHOLE_PASSWORD` eintragen
3. `npm install`

## Entwicklung

| Befehl | Wirkung |
|---|---|
| `npm run dev:server` | Backend-Proxy auf :5641 (pollt Pi-hole, SSE) |
| `npm run dev:web` | Vite-Dev-Server auf :5173 (proxyt /events, /api) |
| `npm test` | Alle Tests (shared, server, web) |

## Production

`npm run build`, dann reicht `npm run start -w server` — der Server liefert
`web/dist` mit aus: <http://localhost:5641>

## Architektur

SSE-Pipeline: Pi-hole v6 API → Poller (Cursor + Dedupe + Backoff) →
Broadcaster → `/events` → GraphStore (immutable, Decay) → d3-force →
Pixi.js-WebGL-Renderer. Details: `docs/superpowers/specs/`.
```

- [ ] **Step 2: Letzter Gesamtlauf**

Run: `npm test`
Expected: alle Workspaces PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add readme with setup and architecture overview"
```
