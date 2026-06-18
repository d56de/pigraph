# Client-Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a click-to-expand client overview under the top-left HUD `Clients` metric, with a live "Aktiv" tab (from the graph) and an "Alle 24h" tab (from Pi-hole).

**Architecture:** A new Pi-hole `top_clients` fetch flows through the existing poller → broadcaster → SSE → a new web store (24h list). The live tab is derived purely from the existing graph store. A new `ClientsList` component renders inside the HUD's top-left panel, toggled by a store. Row clicks reuse the existing highlight/selection mechanism.

**Tech Stack:** TypeScript, Zod (shared events), Hono (server), Svelte 5 runes (web), Vitest.

Spec: `docs/superpowers/specs/2026-06-13-client-insights-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/src/events.ts` | add `ClientStat` + `ClientsEvent` to the event union |
| `server/src/pihole-client.ts` | `fetchTopClients()` — Pi-hole top_clients (total + blocked merge) |
| `server/src/poller.ts` | broadcast a `clients` event on its own slow cadence |
| `server/src/index.ts` | wire `topClientsEveryNPolls` |
| `web/src/lib/clients/clients-store.ts` | latest 24h list (from `clients` event) |
| `web/src/lib/clients/clients-panel-store.ts` | panel open/closed |
| `web/src/lib/clients/active-clients.ts` | pure derivation of the live tab from `GraphState` |
| `web/src/lib/clients/ClientsList.svelte` | tabs + rows (presentational) |
| `web/src/lib/hud/hud-store.ts` | handle new `clients` event (no-op for HUD) |
| `web/src/lib/hud/Hud.svelte` | `Clients` metric → toggle; render `ClientsList` |
| `web/src/App.svelte` | apply `clients` event; pass `getState`/`onSelectClient` to HUD |

---

## Task 1: Shared `ClientsEvent` schema

**Files:**
- Modify: `shared/src/events.ts`
- Test: `shared/test/events.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `shared/test/events.test.ts`:

```ts
import { ClientsEventSchema, ServerEventSchema } from "../src/events.js";

describe("ClientsEventSchema", () => {
  const valid = {
    type: "clients",
    generatedAt: 1_700_000_000,
    clients: [{ ip: "192.168.1.10", name: "iphone", total: 1234, blocked: 56 }],
  };

  it("accepts a valid clients event", () => {
    expect(ClientsEventSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty client list", () => {
    expect(ClientsEventSchema.parse({ ...valid, clients: [] }).clients).toEqual([]);
  });

  it("rejects a negative total", () => {
    const bad = { ...valid, clients: [{ ...valid.clients[0], total: -1 }] };
    expect(ClientsEventSchema.safeParse(bad).success).toBe(false);
  });

  it("is part of the ServerEvent union", () => {
    expect(ServerEventSchema.parse(valid).type).toBe("clients");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — `ClientsEventSchema` is not exported.

- [ ] **Step 3: Implement the schema**

In `shared/src/events.ts`, add after `QueryEventSchema`/before `ServerEventSchema`:

```ts
export const ClientStatSchema = z.object({
  ip: z.string().min(1),
  name: z.string().min(1),
  total: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type ClientStat = z.infer<typeof ClientStatSchema>;

export const ClientsEventSchema = z.object({
  type: z.literal("clients"),
  generatedAt: z.number().nonnegative(),
  clients: z.array(ClientStatSchema),
});
export type ClientsEvent = z.infer<typeof ClientsEventSchema>;
```

Then add `ClientsEventSchema` to the union:

```ts
export const ServerEventSchema = z.discriminatedUnion("type", [
  QueryEventSchema,
  SummaryEventSchema,
  StatusEventSchema,
  ClientsEventSchema,
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (all shared tests).

- [ ] **Step 5: Commit**

```bash
git add shared/src/events.ts shared/test/events.test.ts
git commit -m "feat(shared): add ClientsEvent (per-client 24h stats)"
```

---

## Task 2: `PiholeClient.fetchTopClients`

**Files:**
- Modify: `server/src/pihole-client.ts`
- Test: `server/test/pihole-client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/test/pihole-client.test.ts` (match the existing mock-fetch style in that file — a `fetchFn` returning `{ ok, status, json }`):

```ts
it("fetchTopClients merges total and blocked counts by ip", async () => {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    if (url.includes("/api/auth")) {
      return { ok: true, status: 200, json: async () => ({ session: { valid: true, sid: "s" } }) };
    }
    if (url.includes("blocked=true")) {
      return { ok: true, status: 200, json: async () => ({ clients: [{ ip: "10.0.0.1", name: "a", count: 5 }] }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ clients: [
        { ip: "10.0.0.1", name: "a", count: 50 },
        { ip: "10.0.0.2", name: "", count: 20 },
      ] }),
    };
  }) as unknown as typeof fetch;

  const client = new PiholeClient("http://pi", "pw", fetchFn);
  const event = await client.fetchTopClients(50);

  expect(event.type).toBe("clients");
  expect(event.clients).toEqual([
    { ip: "10.0.0.1", name: "a", total: 50, blocked: 5 },
    { ip: "10.0.0.2", name: "10.0.0.2", total: 20, blocked: 0 }, // name falls back to ip
  ]);
  expect(calls.some((u) => u.includes("/api/stats/top_clients?count=50"))).toBe(true);
  expect(calls.some((u) => u.includes("blocked=true"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — `fetchTopClients` is not a function.

- [ ] **Step 3: Implement `fetchTopClients`**

In `server/src/pihole-client.ts`, update the import and add the method:

```ts
import type { ClientsEvent, ClientStat, QueryEvent, SummaryEvent } from "@pihole-viz/shared";
```

Add inside the `PiholeClient` class (after `fetchSummary`):

```ts
async fetchTopClients(count = 50): Promise<ClientsEvent> {
  type Raw = { clients?: Array<{ ip?: string | null; name?: string | null; count?: number | null }> };
  const [totalRes, blockedRes] = (await Promise.all([
    this.request(`/api/stats/top_clients?count=${count}`),
    this.request(`/api/stats/top_clients?blocked=true&count=${count}`),
  ])) as [Raw, Raw];

  const blockedByIp = new Map<string, number>();
  for (const c of blockedRes.clients ?? []) {
    if (c.ip) blockedByIp.set(c.ip, c.count ?? 0);
  }
  const clients: ClientStat[] = (totalRes.clients ?? [])
    .filter((c): c is { ip: string; name?: string | null; count?: number | null } => !!c.ip)
    .map((c) => ({
      ip: c.ip,
      name: c.name && c.name.length > 0 ? c.name : c.ip,
      total: c.count ?? 0,
      blocked: blockedByIp.get(c.ip) ?? 0,
    }));

  return { type: "clients", generatedAt: Math.floor(Date.now() / 1000), clients };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Verify the real endpoint shape against the live Pi-hole**

The Pi-hole v6 field names (`ip`/`name`/`count`) are assumed. Confirm against the running instance before relying on it. From the repo machine (has SSH to the Pi):

```bash
ssh pi@docker.local 'SID=$(curl -s -X POST http://localhost/api/auth -H "content-type: application/json" -d "{\"password\":\"'"$PIHOLE_PW"'\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"session\"][\"sid\"])"); curl -s "http://localhost/api/stats/top_clients?count=3" -H "X-FTL-SID: $SID"'
```

If the keys differ (e.g. `count` vs `queries`), adjust the `Raw` type and the mapping in Step 3, and update the test in Step 1 to match the real shape. (Provide `PIHOLE_PW` inline; do not commit it.)

- [ ] **Step 6: Commit**

```bash
git add server/src/pihole-client.ts server/test/pihole-client.test.ts
git commit -m "feat(server): fetch per-client 24h stats from Pi-hole top_clients"
```

---

## Task 3: Poller broadcasts `clients` on a slow cadence

**Files:**
- Modify: `server/src/poller.ts`, `server/src/index.ts`
- Test: `server/test/poller.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/test/poller.test.ts` (reuse the file's existing fake-client + fake-timer helpers; the snippet below shows the new client method and assertion — adapt variable names to the file's existing harness):

```ts
it("broadcasts a clients event on the topClients cadence", async () => {
  const events: string[] = [];
  const client = {
    fetchQueriesSince: async () => [],
    fetchSummary: async () => ({
      type: "summary" as const, totalQueries: 0, blockedQueries: 0, percentBlocked: 0, activeClients: 0,
    }),
    fetchTopClients: async () => ({ type: "clients" as const, generatedAt: 1, clients: [] }),
  };
  const poller = new QueryPoller({
    client,
    pollIntervalMs: 1000,
    summaryEveryNPolls: 100,
    topClientsEveryNPolls: 1, // every poll, for the test
    onEvent: (e) => events.push(e.type),
    nowSeconds: () => 1000,
  });
  poller.start();
  await new Promise((r) => setTimeout(r, 5)); // let the first poll resolve
  poller.stop();
  expect(events).toContain("clients");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — `topClientsEveryNPolls` not used / no `clients` event emitted.

- [ ] **Step 3: Implement the cadence**

In `server/src/poller.ts`, update imports and interfaces:

```ts
import type { ClientsEvent, QueryEvent, ServerEvent, SummaryEvent } from "@pihole-viz/shared";

export interface PollerClient {
  fetchQueriesSince(fromSeconds: number): Promise<QueryEvent[]>;
  fetchSummary(): Promise<SummaryEvent>;
  fetchTopClients?(count?: number): Promise<ClientsEvent>;
}

export interface PollerOptions {
  client: PollerClient;
  pollIntervalMs: number;
  summaryEveryNPolls: number;
  topClientsEveryNPolls?: number;
  onEvent: (event: ServerEvent) => void;
  nowSeconds?: () => number;
}
```

In `poll()`, immediately after the existing summary block (`if (this.opts.summaryEveryNPolls ...) { ... fetchSummary() }`), add:

```ts
const tcEvery = this.opts.topClientsEveryNPolls ?? 0;
if (tcEvery >= 1 && this.polls % tcEvery === 1 && this.opts.client.fetchTopClients) {
  // Eigener, langsamer Takt; ein Fehler hier darf den Query-Stream nicht kippen.
  try {
    this.opts.onEvent(await this.opts.client.fetchTopClients());
  } catch (err) {
    console.error("[poller] top_clients fehlgeschlagen:", err);
  }
}
```

In `server/src/index.ts`, add the cadence to the `QueryPoller` options (after `summaryEveryNPolls: 5,`):

```ts
  // 24h-Client-Statistik ändert sich langsam → bei 2s-Poll ~alle 30s.
  topClientsEveryNPolls: 15,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server`
Expected: PASS (new + existing poller tests; existing tests omit `topClientsEveryNPolls` and `fetchTopClients`, which are optional, so they still pass).

- [ ] **Step 5: Commit**

```bash
git add server/src/poller.ts server/src/index.ts server/test/poller.test.ts
git commit -m "feat(server): broadcast clients event on a slow poll cadence"
```

---

## Task 4: Web stores (24h list, panel open) + HUD event handling

**Files:**
- Create: `web/src/lib/clients/clients-store.ts`, `web/src/lib/clients/clients-panel-store.ts`
- Modify: `web/src/lib/hud/hud-store.ts`
- Test: `web/test/clients-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/clients-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { clients24h, setClients } from "../src/lib/clients/clients-store.js";
import type { ClientStat } from "@pihole-viz/shared";

describe("clients-store", () => {
  it("starts empty and replaces the list", () => {
    expect(get(clients24h)).toEqual([]);
    const list: ClientStat[] = [{ ip: "10.0.0.1", name: "a", total: 5, blocked: 1 }];
    setClients(list);
    expect(get(clients24h)).toEqual(list);
    setClients([]);
    expect(get(clients24h)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the stores and the HUD no-op case**

Create `web/src/lib/clients/clients-store.ts`:

```ts
import { writable } from "svelte/store";
import type { ClientStat } from "@pihole-viz/shared";

/** Letzte 24h-Client-Liste aus dem `clients`-Event. */
export const clients24h = writable<ClientStat[]>([]);

export function setClients(list: ClientStat[]): void {
  clients24h.set(list);
}
```

Create `web/src/lib/clients/clients-panel-store.ts`:

```ts
import { writable } from "svelte/store";

/** Ist das Client-Panel unter dem HUD aufgeklappt? */
export const clientsPanelOpen = writable(false);

export function toggleClientsPanel(): void {
  clientsPanelOpen.update((v) => !v);
}
export function closeClientsPanel(): void {
  clientsPanelOpen.set(false);
}
```

In `web/src/lib/hud/hud-store.ts`, the `applyServerEvent` switch must stay exhaustive now that `ServerEvent` has a `clients` member. Add this case (the 24h list is handled in `App.svelte`, not the HUD):

```ts
      case "clients":
        return state; // vom Client-Panel verarbeitet, kein HUD-Effekt
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/clients/clients-store.ts web/src/lib/clients/clients-panel-store.ts web/src/lib/hud/hud-store.ts web/test/clients-store.test.ts
git commit -m "feat(web): clients 24h store + panel-open store"
```

---

## Task 5: Pure `activeClients` derivation (live tab)

**Files:**
- Create: `web/src/lib/clients/active-clients.ts`
- Test: `web/test/active-clients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/active-clients.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeClients } from "../src/lib/clients/active-clients.js";
import type { GraphState } from "../src/lib/graph/store.js";

function state(): GraphState {
  return {
    nodes: new Map([
      ["client:10.0.0.1", { id: "client:10.0.0.1", kind: "client", label: "iphone", blocked: false, hits: 10, lastSeen: 1000 }],
      ["client:10.0.0.2", { id: "client:10.0.0.2", kind: "client", label: "nas", blocked: false, hits: 3, lastSeen: 0 }],
      ["domain:a.com", { id: "domain:a.com", kind: "domain", label: "a.com", blocked: false, hits: 7, lastSeen: 1000 }],
      ["domain:ad.com", { id: "domain:ad.com", kind: "domain", label: "ad.com", blocked: true, hits: 6, lastSeen: 1000 }],
    ]),
    edges: new Map([
      ["client:10.0.0.1->domain:a.com", { source: "client:10.0.0.1", target: "domain:a.com", hits: 7, lastSeen: 1000, blocked: false }],
      ["client:10.0.0.1->domain:ad.com", { source: "client:10.0.0.1", target: "domain:ad.com", hits: 3, lastSeen: 1000, blocked: true }],
      ["client:10.0.0.2->domain:a.com", { source: "client:10.0.0.2", target: "domain:a.com", hits: 3, lastSeen: 0, blocked: false }],
    ]),
  } as unknown as GraphState;
}

describe("activeClients", () => {
  it("derives totals, blocked, and activeNow, sorted by total desc", () => {
    const rows = activeClients(state(), 2000); // window 5000ms → both within
    expect(rows.map((r) => r.ip)).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(rows[0]).toMatchObject({ name: "iphone", total: 10, blocked: 3, activeNow: true });
    expect(rows[1]).toMatchObject({ name: "nas", total: 3, blocked: 0 });
  });

  it("marks a client idle once its lastSeen is outside the window", () => {
    const rows = activeClients(state(), 10_000); // 10000-1000 > 5000 → idle
    expect(rows.find((r) => r.ip === "10.0.0.1")?.activeNow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the derivation**

Create `web/src/lib/clients/active-clients.ts`:

```ts
import type { GraphState } from "../graph/store.js";

export interface ActiveClient {
  id: string;
  ip: string;
  name: string;
  total: number;
  blocked: number;
  activeNow: boolean;
}

/** Eine Query gilt als "jetzt aktiv", wenn sie jünger als dieses Fenster ist. */
const ACTIVE_WINDOW_MS = 5000;

/** Live-Client-Zeilen aus dem aktuellen Graph-Zustand (Totals/Blocked aus Kanten). */
export function activeClients(state: GraphState, nowMs: number): ActiveClient[] {
  const totals = new Map<string, { total: number; blocked: number }>();
  for (const e of state.edges.values()) {
    const cur = totals.get(e.source) ?? { total: 0, blocked: 0 };
    cur.total += e.hits;
    if (e.blocked) cur.blocked += e.hits;
    totals.set(e.source, cur);
  }

  const rows: ActiveClient[] = [];
  for (const node of state.nodes.values()) {
    if (node.kind !== "client") continue;
    const t = totals.get(node.id) ?? { total: 0, blocked: 0 };
    rows.push({
      id: node.id,
      ip: node.id.slice("client:".length),
      name: node.label,
      total: t.total,
      blocked: t.blocked,
      activeNow: nowMs - node.lastSeen < ACTIVE_WINDOW_MS,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/clients/active-clients.ts web/test/active-clients.test.ts
git commit -m "feat(web): pure activeClients derivation for the live tab"
```

---

## Task 6: `ClientsList.svelte` component

**Files:**
- Create: `web/src/lib/clients/ClientsList.svelte`

(No unit test — presentational; logic is covered by Tasks 4–5. Verified via build + manual QA in Task 9.)

- [ ] **Step 1: Create the component**

Create `web/src/lib/clients/ClientsList.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from "svelte";
  import type { GraphState } from "../graph/store.js";
  import { activeClients, type ActiveClient } from "./active-clients.js";
  import { clients24h } from "./clients-store.js";

  interface Props {
    getState: () => GraphState;
    onSelect: (id: string) => void;
  }
  let { getState, onSelect }: Props = $props();

  let tab = $state<"active" | "all">("active");
  let active = $state<ActiveClient[]>([]);

  // Aktiv-Tab lebt: jede Sekunde aus dem Graph neu ableiten (wie DetailCard pollt).
  const refresh = () => (active = activeClients(getState(), Date.now()));
  refresh();
  const timer = setInterval(refresh, 1000);
  onDestroy(() => clearInterval(timer));

  let activeIps = $derived(new Set(active.map((c) => c.ip)));
  const pct = (total: number, blocked: number) =>
    total === 0 ? 0 : Math.round((blocked / total) * 100);
</script>

<div class="clients">
  <div class="tabs">
    <button class:on={tab === "active"} onclick={() => (tab = "active")}>Aktiv</button>
    <button class:on={tab === "all"} onclick={() => (tab = "all")}>Alle 24h</button>
  </div>

  <ul>
    {#if tab === "active"}
      {#each active as c (c.id)}
        <li>
          <button class="row" onclick={() => onSelect(c.id)}>
            <span class="dot" class:idle={!c.activeNow}></span>
            <span class="name">{c.name}</span>
            <span class="ip">{c.ip}</span>
            <span class="q">{c.total.toLocaleString("de-DE")}</span>
            <span class="pct">{pct(c.total, c.blocked)}%</span>
          </button>
        </li>
      {:else}
        <li class="empty">keine aktiven Clients</li>
      {/each}
    {:else}
      {#each $clients24h as c (c.ip)}
        <li>
          <button class="row" onclick={() => onSelect(`client:${c.ip}`)}>
            <span class="dot" class:idle={!activeIps.has(c.ip)}></span>
            <span class="name">{c.name}</span>
            <span class="ip">{c.ip}</span>
            <span class="q">{c.total.toLocaleString("de-DE")}</span>
            <span class="pct">{pct(c.total, c.blocked)}%</span>
          </button>
        </li>
      {:else}
        <li class="empty">lädt…</li>
      {/each}
    {/if}
  </ul>
</div>

<style>
  .clients { margin-top: 10px; border-top: 1px solid var(--panel-border); padding-top: 8px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 6px; }
  .tabs button {
    background: none; border: none; cursor: pointer;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-dim); padding: 3px 8px; border-radius: 5px;
    font-family: -apple-system, sans-serif;
  }
  .tabs button.on { background: var(--panel-border); color: var(--text); }

  ul { list-style: none; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
  .row {
    width: 100%; display: grid; grid-template-columns: 10px 1fr auto auto auto;
    align-items: baseline; gap: 8px;
    background: none; border: none; cursor: pointer; text-align: left;
    padding: 3px 4px; border-radius: 5px;
    font-size: 12px; font-family: ui-monospace, "SF Mono", monospace; color: var(--text);
  }
  .row:hover { background: var(--panel-border); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--allowed); align-self: center; }
  .dot.idle { background: var(--text-dim); opacity: 0.5; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ip { color: var(--text-dim); font-size: 10px; }
  .q { font-variant-numeric: tabular-nums; }
  .pct { color: var(--text-dim); font-variant-numeric: tabular-nums; min-width: 32px; text-align: right; }
  .empty { color: var(--text-dim); font-size: 12px; padding: 6px 4px; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p web` (or `cd web && npx tsc --noEmit`)
Expected: no errors. (Component is not yet rendered; wired in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/clients/ClientsList.svelte
git commit -m "feat(web): ClientsList component (Aktiv / Alle 24h tabs)"
```

---

## Task 7: Wire HUD toggle + render `ClientsList`

**Files:**
- Modify: `web/src/lib/hud/Hud.svelte`

- [ ] **Step 1: Update the HUD script**

In `web/src/lib/hud/Hud.svelte`, extend the `<script>` block:

```ts
  import { hud } from "./hud-store.js";
  import type { GraphState } from "../graph/store.js";
  import ClientsList from "../clients/ClientsList.svelte";
  import { clientsPanelOpen, toggleClientsPanel, closeClientsPanel } from "../clients/clients-panel-store.js";

  interface Props {
    getState: () => GraphState;
    onSelectClient: (id: string) => void;
  }
  let { getState, onSelectClient }: Props = $props();

  let panelEl = $state<HTMLDivElement | null>(null);

  const CIRCUMFERENCE = 2 * Math.PI * 26;
  const version = __APP_VERSION__;
  let dash = $derived((($hud.percent ?? 0) / 100) * CIRCUMFERENCE);

  // Klick außerhalb des Panels schließt es.
  function onWindowClick(e: MouseEvent) {
    if (!$clientsPanelOpen) return;
    if (panelEl && !panelEl.contains(e.target as Node)) closeClientsPanel();
  }
```

- [ ] **Step 2: Update the top-left panel markup**

Replace the existing `<div class="panel top-left"> … </div>` block with:

```svelte
<svelte:window onkeydown={(e) => e.key === "Escape" && closeClientsPanel()} onclick={onWindowClick} />

<div class="panel top-left" bind:this={panelEl}>
  <div class="metrics">
    <div class="metric">
      <span class="label">Queries heute</span>
      <span class="value">{$hud.total.toLocaleString("de-DE")}</span>
    </div>
    <div class="metric">
      <span class="label">Geblockt</span>
      <span class="value blocked">{$hud.blocked.toLocaleString("de-DE")}</span>
    </div>
    <button class="metric clients-btn" onclick={(e) => { e.stopPropagation(); toggleClientsPanel(); }}>
      <span class="label">Clients</span>
      <span class="value">{$hud.clients}<span class="caret" class:open={$clientsPanelOpen}>▾</span></span>
    </button>
  </div>
  {#if $clientsPanelOpen}
    <ClientsList {getState} onSelect={onSelectClient} />
  {/if}
</div>
```

(`e.stopPropagation()` prevents the same click from immediately reaching `onWindowClick` and closing the panel.)

- [ ] **Step 3: Update the top-left styles**

In the `<style>` block, replace `.top-left { top: 16px; left: 16px; display: flex; gap: 24px; }` with:

```css
  .top-left { top: 16px; left: 16px; display: flex; flex-direction: column; align-items: stretch; }
  .metrics { display: flex; gap: 24px; }
  .clients-btn {
    background: none; border: none; padding: 0; margin: 0; cursor: pointer;
    text-align: left; font: inherit; color: inherit;
  }
  .caret { font-size: 11px; color: var(--text-dim); margin-left: 4px; display: inline-block; transition: transform 0.15s; }
  .caret.open { transform: rotate(180deg); }
```

- [ ] **Step 4: Type-check + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: build succeeds. (`Hud` now requires props — the App change in Task 8 provides them; until then `tsc` may flag the missing props at the `<Hud />` call site, which Task 8 fixes. Run `tsc` again after Task 8.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/Hud.svelte
git commit -m "feat(web): toggle clients panel from the HUD Clients metric"
```

---

## Task 8: Wire the `clients` event + selection in `App.svelte`

**Files:**
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Add imports**

In `web/src/App.svelte` `<script>`, add:

```ts
  import { setClients } from "./lib/clients/clients-store.js";
```

- [ ] **Step 2: Add the panel-selection handler (component scope)**

Add near the other top-level declarations (after `let highlighted: string | null = null;`):

```ts
  // Auswahl aus dem Client-Panel: nur hervorheben, wenn der Client gerade einen Live-Knoten hat.
  function selectClientFromPanel(id: string): void {
    if (!currentView.nodes.has(id)) return; // 24h-Client ohne Live-Knoten → nur Panel-Stats
    highlighted = id;
    renderer?.setHighlight(id);
    selectNode(id);
  }
```

- [ ] **Step 3: Handle the `clients` event in the stream**

In the `connectStream("/events", { onEvent(event) { … } })` handler, after the existing `if (event.type === "query") { … }` block, add:

```ts
          else if (event.type === "clients") {
            setClients(event.clients);
          }
```

- [ ] **Step 4: Pass props to `<Hud />`**

Replace `<Hud />` in the markup with:

```svelte
<Hud getState={getGraph} onSelectClient={selectClientFromPanel} />
```

- [ ] **Step 5: Type-check, build, full test**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.svelte
git commit -m "feat(web): apply clients event and wire panel selection"
```

---

## Task 9: Full verification + deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test` (from repo root — runs shared, server, web)
Expected: all suites pass.

- [ ] **Step 2: Typecheck + build all touched workspaces**

Run: `npm run build -w shared && npm run build -w server && npm run build -w web` (or the repo's equivalents)
Expected: clean.

- [ ] **Step 3: Manual QA (local dev)**

```bash
HOST=0.0.0.0 npm run dev:server
npm run dev:web -- --host
```
Open `http://localhost:5173` and verify:
- Top-left `Clients NN` shows a `▾` and toggles the panel on click.
- `Aktiv` tab lists live clients; dots fill/hollow with activity; rows sorted by queries.
- Clicking a row highlights the node + opens its DetailCard.
- `Alle 24h` tab populates within ~30 s (after the first `clients` poll) and length ≈ the NN count.
- `Esc` and a click outside close the panel.
- Switch themes → panel + dots recolour.

- [ ] **Step 4: Deploy to the Pi**

Per `deploy-pipeline` project memory:
1. Snapshot + force-push (user runs): `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force`
2. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main && docker-compose up -d --build --force-recreate`
3. Verify served bundle at `http://<pi>:8089` contains the new code (e.g. `grep -rl "Alle 24h" web/dist/assets/` in the container).

- [ ] **Step 5: Update CHANGELOG**

Add to `CHANGELOG.md` under a new `## [Unreleased]` or a version bump:
```
### Added
- Client overview panel under the HUD Clients metric (live tab + Pi-hole 24h tab).
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for client-insights"
```

---

## Self-Review notes

- **Spec coverage:** two-tier source (Tasks 2/3 = 24h, Task 5 = live), expand-from-HUD layout (Task 7), row fields + dot semantics (Task 6), row-click highlight (Task 8), theming (CSS vars throughout), no-Tailscale (absent by design). ✓
- **Type consistency:** `ClientStat {ip,name,total,blocked}` defined in Task 1 and used identically in Tasks 2/4/6; `ActiveClient` defined in Task 5 and consumed in Task 6; `fetchTopClients` signature consistent across Tasks 2/3. ✓
- **Known unknown:** Pi-hole `top_clients` field names — Task 2 Step 5 verifies against the live instance and adjusts if needed. This is the single assumption and it has an explicit verification step.
