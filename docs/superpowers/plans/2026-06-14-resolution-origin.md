# Resolution Origin (Cache / Unbound / Blocked) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show where each DNS answer came from — Pi-hole cache, Unbound (forwarded), or blocked — as a 3-segment donut and a per-row dot in the live feed.

**Architecture:** The origin is already in the data: each query carries `status` (CACHE / FORWARDED / GRAVITY…) and the Pi-hole summary carries `cached`/`forwarded` counts. A pure classifier maps status→origin for the feed; the summary's cached/forwarded counts drive a 3-segment donut. No new data source, no Unbound access.

**Tech Stack:** TypeScript, Zod (shared), Hono (server), Svelte 5 runes (web), Vitest.

Spec: `docs/superpowers/specs/2026-06-14-resolution-origin-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/src/events.ts` | `SummaryEvent` += `cached`, `forwarded` |
| `server/src/pihole-client.ts` | `fetchSummary` reads cached/forwarded |
| `web/src/lib/hud/resolution-origin.ts` | pure status→origin classifier |
| `web/src/lib/hud/donut.ts` | pure donut-segment math |
| `web/src/lib/theme/themes.ts` | css palette += `forwarded` color |
| `web/src/app.css` | `--forwarded` default var |
| `web/src/App.svelte` | `applyTheme` sets `--forwarded` |
| `web/src/lib/hud/hud-store.ts` | `HudState` += cached/forwarded; `FeedItem` += origin |
| `web/src/lib/hud/Hud.svelte` | 3-segment donut + feed origin dot |

---

## Task 1: Shared SummaryEvent gains cached/forwarded

**Files:**
- Modify: `shared/src/events.ts`
- Test: `shared/test/events.test.ts`

- [ ] **Step 1: Write the failing test** — append to `shared/test/events.test.ts`:

```ts
describe("SummaryEvent cached/forwarded", () => {
  it("parses cached and forwarded", () => {
    const e = SummaryEventSchema.parse({
      type: "summary", totalQueries: 100, blockedQueries: 8, percentBlocked: 8,
      activeClients: 5, cached: 60, forwarded: 32,
    });
    expect(e.cached).toBe(60);
    expect(e.forwarded).toBe(32);
  });

  it("leaves cached/forwarded undefined when absent (older server)", () => {
    const e = SummaryEventSchema.parse({
      type: "summary", totalQueries: 1, blockedQueries: 0, percentBlocked: 0, activeClients: 1,
    });
    expect(e.cached).toBeUndefined();
    expect(e.forwarded).toBeUndefined();
  });
});
```

(`SummaryEventSchema` is already imported in this test file; if not, add it to the existing import from `../src/events.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — `e.cached` is undefined.

- [ ] **Step 3: Implement** — in `shared/src/events.ts`, add two fields to `SummaryEventSchema`:

```ts
export const SummaryEventSchema = z.object({
  type: z.literal("summary"),
  totalQueries: z.number().nonnegative(),
  blockedQueries: z.number().nonnegative(),
  percentBlocked: z.number().min(0).max(100),
  activeClients: z.number().nonnegative(),
  cached: z.number().nonnegative().optional(),
  forwarded: z.number().nonnegative().optional(),
});
```

Optional (not defaulted) so the 5 existing `type: "summary"` test literals across web/server stay valid; consumers default to 0 with `?? 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/events.ts shared/test/events.test.ts
git commit -m "feat(shared): SummaryEvent carries cached and forwarded counts"
```

---

## Task 2: Server reads cached/forwarded from the summary

**Files:**
- Modify: `server/src/pihole-client.ts`
- Test: `server/test/pihole-client.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/test/pihole-client.test.ts`:

```ts
it("fetchSummary maps cached and forwarded", async () => {
  const fetchFn = (async (url: string) => {
    if (url.includes("/api/auth")) {
      return { ok: true, status: 200, json: async () => ({ session: { valid: true, sid: "s" } }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        queries: { total: 100, blocked: 8, percent_blocked: 8, cached: 60, forwarded: 32 },
        clients: { active: 5 },
      }),
    };
  }) as unknown as typeof fetch;

  const client = new PiholeClient("http://pi", "pw", fetchFn);
  const summary = await client.fetchSummary();
  expect(summary.cached).toBe(60);
  expect(summary.forwarded).toBe(32);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — `summary.cached` is undefined.

- [ ] **Step 3: Implement** — in `server/src/pihole-client.ts`, update `fetchSummary`'s response type and return object:

```ts
async fetchSummary(): Promise<SummaryEvent> {
  const data = (await this.request("/api/stats/summary")) as {
    queries?: { total?: number; blocked?: number; percent_blocked?: number; cached?: number; forwarded?: number };
    clients?: { active?: number };
  };
  return {
    type: "summary",
    totalQueries: data.queries?.total ?? 0,
    blockedQueries: data.queries?.blocked ?? 0,
    percentBlocked: data.queries?.percent_blocked ?? 0,
    activeClients: data.clients?.active ?? 0,
    cached: data.queries?.cached ?? 0,
    forwarded: data.queries?.forwarded ?? 0,
  };
}
```

**Note:** the Pi-hole v6 field names `queries.cached` / `queries.forwarded` are assumed from the dashboard. Confirm against the live `/api/stats/summary` during execution (the repo machine has SSH to the Pi); adjust the keys + the Step-1 test if they differ. Do not commit any credentials.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w server`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add server/src/pihole-client.ts server/test/pihole-client.test.ts
git commit -m "feat(server): carry cached/forwarded counts from Pi-hole summary"
```

---

## Task 3: Pure `resolutionOrigin` classifier

**Files:**
- Create: `web/src/lib/hud/resolution-origin.ts`
- Test: `web/test/resolution-origin.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/resolution-origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolutionOrigin } from "../src/lib/hud/resolution-origin.js";

describe("resolutionOrigin", () => {
  it("blocked wins regardless of status", () => {
    expect(resolutionOrigin("GRAVITY", true)).toBe("blocked");
    expect(resolutionOrigin("FORWARDED", true)).toBe("blocked");
  });
  it("classifies cache statuses", () => {
    expect(resolutionOrigin("CACHE", false)).toBe("cache");
    expect(resolutionOrigin("CACHE_STALE", false)).toBe("cache");
  });
  it("classifies forwarded as unbound", () => {
    expect(resolutionOrigin("FORWARDED", false)).toBe("unbound");
    expect(resolutionOrigin("FORWARD", false)).toBe("unbound");
  });
  it("everything else is other", () => {
    expect(resolutionOrigin("IN_PROGRESS", false)).toBe("other");
    expect(resolutionOrigin("UNKNOWN", false)).toBe("other");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `web/src/lib/hud/resolution-origin.ts`:

```ts
export type ResolutionOrigin = "blocked" | "cache" | "unbound" | "other";

const CACHE_STATUSES = new Set(["CACHE", "CACHE_STALE"]);
const FORWARDED_STATUSES = new Set(["FORWARDED", "FORWARD"]);

/** Woher kam die Antwort: blockiert / Cache / Unbound (forwarded) / sonstiges. */
export function resolutionOrigin(status: string, blocked: boolean): ResolutionOrigin {
  if (blocked) return "blocked";
  if (CACHE_STATUSES.has(status)) return "cache";
  if (FORWARDED_STATUSES.has(status)) return "unbound";
  return "other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/resolution-origin.ts web/test/resolution-origin.test.ts
git commit -m "feat(web): pure resolutionOrigin classifier"
```

---

## Task 4: Pure donut-segment math

**Files:**
- Create: `web/src/lib/hud/donut.ts`
- Test: `web/test/donut.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/donut.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { donutSegments } from "../src/lib/hud/donut.js";

describe("donutSegments", () => {
  it("returns cache/unbound/blocked arcs with cumulative rotation", () => {
    const segs = donutSegments({ cache: 50, unbound: 30, blocked: 20, total: 100 }, 100);
    expect(segs.map((s) => Math.round(s.dash))).toEqual([50, 30, 20]);
    expect(segs.map((s) => Math.round(s.rotate))).toEqual([0, 180, 288]);
    expect(segs.map((s) => s.color)).toEqual(["var(--allowed)", "var(--forwarded)", "var(--blocked)"]);
  });

  it("handles zero total without dividing by zero", () => {
    const segs = donutSegments({ cache: 0, unbound: 0, blocked: 0, total: 0 }, 100);
    expect(segs.every((s) => s.dash === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `web/src/lib/hud/donut.ts`:

```ts
export interface DonutSegment {
  color: string;
  dash: number; // Arc-Länge in Pixeln (Umfangsanteil)
  rotate: number; // Startwinkel in Grad
}

export interface DonutCounts {
  cache: number;
  unbound: number;
  blocked: number;
  total: number;
}

/** Drei Ring-Segmente (Cache/Unbound/Blocked) als Arc-Länge + Startwinkel. */
export function donutSegments(counts: DonutCounts, circumference: number): DonutSegment[] {
  const t = counts.total > 0 ? counts.total : 1;
  const order = [
    { value: counts.cache, color: "var(--allowed)" },
    { value: counts.unbound, color: "var(--forwarded)" },
    { value: counts.blocked, color: "var(--blocked)" },
  ];
  let acc = 0;
  return order.map((s) => {
    const seg: DonutSegment = {
      color: s.color,
      dash: (s.value / t) * circumference,
      rotate: (acc / t) * 360,
    };
    acc += s.value;
    return seg;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/donut.ts web/test/donut.test.ts
git commit -m "feat(web): pure donut-segment math for the resolution ring"
```

---

## Task 5: `--forwarded` theme color

**Files:**
- Modify: `web/src/lib/theme/themes.ts`, `web/src/app.css`, `web/src/App.svelte`

- [ ] **Step 1: Add `forwarded` to the CssPalette interface** — in `web/src/lib/theme/themes.ts`, add to the `CssPalette` interface (after `blocked: string;`):

```ts
  forwarded: string;
```

- [ ] **Step 2: Add a `forwarded` value to each theme's `css` block** — in the same file, add one line to each of the three `css: { … }` objects:

- obsidian `css`: `forwarded: "#fbbf24",`
- aurora `css`: `forwarded: "#fde047",`
- nord `css`: `forwarded: "#ebcb8b",`

- [ ] **Step 3: Default var in `web/src/app.css`** — add to the `:root` block (after `--blocked: …;`):

```css
  --forwarded: #fbbf24;
```

- [ ] **Step 4: Apply it in `web/src/App.svelte`** — in `applyTheme`, after the `root.setProperty("--blocked", css.blocked);` line add:

```ts
      root.setProperty("--forwarded", css.forwarded);
```

- [ ] **Step 5: Type-check + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean (the new var isn't consumed yet — wired in Task 7).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/theme/themes.ts web/src/app.css web/src/App.svelte
git commit -m "feat(web): add --forwarded (Unbound) theme color"
```

---

## Task 6: hud-store carries cached/forwarded + feed origin

**Files:**
- Modify: `web/src/lib/hud/hud-store.ts`
- Test: `web/test/hud-store.test.ts`

- [ ] **Step 1: Write the failing test** — append to `web/test/hud-store.test.ts`:

```ts
it("stores cached/forwarded from summary", () => {
  resetHud();
  applyServerEvent({
    type: "summary", totalQueries: 100, blockedQueries: 8, percentBlocked: 8,
    activeClients: 5, cached: 60, forwarded: 32,
  });
  const s = get(hud);
  expect(s.cached).toBe(60);
  expect(s.forwarded).toBe(32);
});

it("tags feed items with their resolution origin", () => {
  resetHud();
  applyServerEvent({
    type: "query", id: 1, time: 1, domain: "a.com", clientIp: "10.0.0.1",
    clientName: "x", blocked: false, status: "FORWARDED",
  });
  expect(get(hud).feed[0].origin).toBe("unbound");
});
```

(Ensure `resetHud`, `applyServerEvent`, `hud`, and `get` are imported in this file; they already are for existing tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — `s.cached` undefined / `origin` undefined.

- [ ] **Step 3: Implement** — in `web/src/lib/hud/hud-store.ts`:

Add the import:

```ts
import { resolutionOrigin, type ResolutionOrigin } from "./resolution-origin.js";
```

Add `origin` to `FeedItem`:

```ts
export interface FeedItem {
  id: number;
  domain: string;
  clientName: string;
  blocked: boolean;
  origin: ResolutionOrigin;
}
```

Add `cached`/`forwarded` to `HudState`:

```ts
export interface HudState {
  total: number;
  blocked: number;
  percent: number;
  clients: number;
  cached: number;
  forwarded: number;
  feed: FeedItem[];
  connected: boolean;
}
```

Add them to `initial` (after `clients: 0,`):

```ts
  cached: 0,
  forwarded: 0,
```

In `applyServerEvent`, the `summary` case returns cached/forwarded:

```ts
      case "summary":
        return {
          ...state,
          total: event.totalQueries,
          blocked: event.blockedQueries,
          percent: event.percentBlocked,
          clients: event.activeClients,
          cached: event.cached ?? 0,
          forwarded: event.forwarded ?? 0,
        };
```

In the `query` case, give the feed item an origin:

```ts
      case "query":
        return {
          ...state,
          feed: [
            {
              id: event.id,
              domain: event.domain,
              clientName: event.clientName,
              blocked: event.blocked,
              origin: resolutionOrigin(event.status, event.blocked),
            },
            ...state.feed,
          ].slice(0, FEED_LIMIT),
        };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS (existing hud-store tests that build feed items still pass — they now also carry `origin`, which they don't assert on).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/hud-store.ts web/test/hud-store.test.ts
git commit -m "feat(web): hud-store keeps cached/forwarded and feed origin"
```

---

## Task 7: Donut 3-segment ring + feed origin dot

**Files:**
- Modify: `web/src/lib/hud/Hud.svelte`

- [ ] **Step 1: Import the donut math + compute segments** — in `Hud.svelte`'s `<script>`, add the import (with the others):

```ts
  import { donutSegments } from "./donut.js";
```

Add a derived value (next to the existing `dash` derived):

```ts
  let segments = $derived(
    donutSegments(
      { cache: $hud.cached, unbound: $hud.forwarded, blocked: $hud.blocked, total: $hud.total },
      CIRCUMFERENCE,
    ),
  );
```

You may delete the now-unused `dash` derived line (`let dash = $derived(...)`) — the single block-rate arc is replaced by the segments.

- [ ] **Step 2: Replace the donut SVG markup** — replace the two `<circle>` elements inside the `.gauge svg` with a track + one circle per segment:

```svelte
  <svg viewBox="0 0 64 64" width="64" height="64">
    <circle cx="32" cy="32" r="26" fill="none" stroke="var(--panel-border)" stroke-width="6" />
    {#each segments as seg}
      <circle
        cx="32" cy="32" r="26" fill="none"
        stroke={seg.color} stroke-width="6" stroke-linecap="butt"
        stroke-dasharray="{seg.dash} {CIRCUMFERENCE}"
        transform="rotate({seg.rotate - 90} 32 32)"
      />
    {/each}
  </svg>
```

(The center `.gauge-text` block with `{$hud.percent.toFixed(1)}%` and "Block-Rate" stays unchanged.)

- [ ] **Step 3: Remove the obsolete `.progress` style** — delete the `.gauge .progress { stroke: var(--blocked); }` rule from `<style>` (the segments set their stroke inline now).

- [ ] **Step 4: Add the origin dot to feed rows** — change the feed `<li>` markup to lead with a dot:

```svelte
    {#each $hud.feed as item (item.id)}
      <li class:blocked={item.blocked}>
        <span class="origin-dot" data-origin={item.origin}></span>
        <span class="domain">{item.domain}</span>
        <span class="client">{item.clientName}</span>
      </li>
    {/each}
```

- [ ] **Step 5: Restyle the feed row + dot** — replace the `.feed li` rule and add the dot rules:

```css
  .feed li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
    color: var(--allowed);
  }
  .feed .domain { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .feed .client { flex: none; color: var(--text-dim); text-decoration: none; }
  .origin-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim); }
  .origin-dot[data-origin="cache"] { background: var(--allowed); }
  .origin-dot[data-origin="unbound"] { background: var(--forwarded); }
  .origin-dot[data-origin="blocked"] { background: var(--blocked); }
```

(Keep the existing `.feed li.blocked { color: var(--blocked); text-decoration: line-through; }` rule.)

- [ ] **Step 6: Type-check, build, test**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/hud/Hud.svelte
git commit -m "feat(web): 3-segment resolution donut and per-row feed origin dot"
```

---

## Task 8: Verify + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full suite + builds**

Run: `npm test` (root) then `cd web && npm run build`
Expected: all suites pass, build clean.

- [ ] **Step 2: Confirm the Pi-hole summary field names against the live API**

The local dev server (`localhost:5641`) talks to the real Pi-hole. Capture a summary event and confirm cached/forwarded are non-zero (proving Step-2's field names are right):

```bash
curl -s -N --max-time 12 http://localhost:5641/events | grep -m1 '"type":"summary"'
```
Expected: JSON containing non-zero `"cached"` and `"forwarded"`. If both are 0 while traffic is flowing, the Pi-hole field names differ — fix Task 2's keys and redeploy.

- [ ] **Step 3: Local visual QA**

Open `http://localhost:5173`: the top-right donut shows three colored arcs (green cache / amber Unbound / red blocked) with block-rate % in the center; feed rows show a leading dot whose color matches the origin. Switch themes → the Unbound color follows. Verify the donut arc direction looks right (clockwise from top); the segment math is unit-tested, only the visual direction needs a human glance.

- [ ] **Step 4: Deploy to the Pi**

Per `deploy-pipeline` project memory:
1. Snapshot + force-push (user runs): `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force`
2. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main && docker-compose up -d --build --force-recreate`
3. Verify served bundle (HTTP 200) and that a `summary` SSE event from `:8089` carries cached/forwarded.

- [ ] **Step 5: Update CHANGELOG**

Add under `## [Unreleased]` (or a version bump) in `CHANGELOG.md`:
```
### Added
- Resolution-origin view: the block-rate donut became a 3-segment ring
  (cache / Unbound-forwarded / blocked) and live-feed rows show a per-query
  origin dot. Adds cached/forwarded to the summary event.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for resolution-origin"
```

---

## Self-Review notes

- **Spec coverage:** classification (Task 3), donut 3-segment (Tasks 4+7), feed dot (Tasks 3+6+7), summary cached/forwarded (Tasks 1+2), `--forwarded` color (Task 5), CACHE_STALE→cache (Task 3 test), block-rate % stays center (Task 7 keeps `.gauge-text`). ✓
- **Type consistency:** `ResolutionOrigin` defined in Task 3, consumed in Task 6; `DonutSegment{color,dash,rotate}` defined in Task 4, consumed in Task 7; `SummaryEvent.cached/forwarded` defined Task 1, produced Task 2, consumed Task 6. ✓
- **Known unknown:** Pi-hole summary field names `cached`/`forwarded` — Task 2 note + Task 8 Step 2 verify them against the live API. Single assumption, with an explicit verification step.
