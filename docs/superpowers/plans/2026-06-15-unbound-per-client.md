# Unbound per Client (live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count per-client Unbound (FORWARDED) queries live and show them as a sortable `↑ n` column in the client panel's Aktiv tab.

**Architecture:** The graph's client node gains a `forwarded` counter incremented in `applyQuery` via the existing `resolutionOrigin` classifier; `tick` preserves it for free (it spreads nodes). `activeClients` exposes it and sorts by it. `ClientsList` renders an amber `↑` column (Aktiv: the number; 24h: `–`, since Pi-hole top_clients lacks the split).

**Tech Stack:** TypeScript, Svelte 5 runes (web), Vitest. Frontend-only — no shared/server/schema change.

Spec: `docs/superpowers/specs/2026-06-15-unbound-per-client-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `web/src/lib/graph/store.ts` | `GraphNode.forwarded?`; `applyQuery` increments it for Unbound queries |
| `web/src/lib/clients/active-clients.ts` | `ActiveClient.forwarded`; sort by forwarded desc |
| `web/src/lib/clients/ClientsList.svelte` | `↑` column (Aktiv number / 24h `–`) |

---

## Task 1: Graph store counts forwarded per client

**Files:**
- Modify: `web/src/lib/graph/store.ts`
- Test: `web/test/graph-store.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `web/test/graph-store.test.ts` (it already has a `q(domain, opts)` helper and imports `applyQuery`, `emptyGraph`, `tick`):

```ts
describe("per-client forwarded (Unbound) count", () => {
  function clientNode(g: ReturnType<typeof emptyGraph>) {
    return [...g.nodes.values()].find((n) => n.kind === "client");
  }

  it("counts only forwarded (Unbound) queries", () => {
    let g = applyQuery(emptyGraph(), q("a.com", { status: "FORWARDED", blocked: false }), 1000);
    g = applyQuery(g, q("b.com", { status: "CACHE", blocked: false }), 1000);
    g = applyQuery(g, q("ad.com", { status: "GRAVITY", blocked: true }), 1000);
    expect(clientNode(g)?.forwarded).toBe(1);
  });

  it("does not count a forwarded-but-blocked query", () => {
    const g = applyQuery(emptyGraph(), q("x.com", { status: "FORWARDED", blocked: true }), 1000);
    expect(clientNode(g)?.forwarded).toBe(0);
  });

  it("keeps forwarded across a decay tick", () => {
    let g = applyQuery(emptyGraph(), q("a.com", { status: "FORWARDED", blocked: false }), 1000);
    g = tick(g, 1000);
    expect(clientNode(g)?.forwarded).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w web`
Expected: FAIL — `forwarded` is undefined on the client node.

- [ ] **Step 3: Implement** — in `web/src/lib/graph/store.ts`:

Add the import (top of file):
```ts
import { resolutionOrigin } from "../hud/resolution-origin.js";
```

Add the optional field to `GraphNode` (after `groupSize?`):
```ts
  /** Anzahl an Unbound forwardeter Queries dieses Clients (nur Client-Knoten). */
  forwarded?: number;
```

In `applyQuery`, set `forwarded` on the rebuilt client node (the client node is a fresh
literal, so the count must be carried explicitly). Replace the existing client-node
`nodes.set(cId, { … })` block with:
```ts
  const client = nodes.get(cId);
  const isUnbound = resolutionOrigin(query.status, query.blocked) === "unbound";
  nodes.set(cId, {
    id: cId,
    kind: "client",
    label: query.clientName,
    blocked: false,
    hits: (client?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
    forwarded: (client?.forwarded ?? 0) + (isUnbound ? 1 : 0),
  });
```

(No `tick` change: `tick` already does `nodes.set(node.id, { ...node, opacity })`, so the
spread preserves `forwarded` — the third test proves it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web`
Expected: PASS (new + all existing graph-store tests; `forwarded?` is optional so existing node literals/assertions are unaffected).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graph/store.ts web/test/graph-store.test.ts
git commit -m "feat(web): count per-client forwarded (Unbound) queries in the graph"
```

---

## Task 2: activeClients exposes forwarded + sorts by it

**Files:**
- Modify: `web/src/lib/clients/active-clients.ts`
- Test: `web/test/active-clients.test.ts`

- [ ] **Step 1: Write the failing test** — append to `web/test/active-clients.test.ts`:

```ts
it("exposes per-client forwarded and sorts by it desc", () => {
  const state = {
    nodes: new Map([
      ["client:10.0.0.1", { id: "client:10.0.0.1", kind: "client", label: "a", blocked: false, hits: 50, lastSeen: 1000, forwarded: 3 }],
      ["client:10.0.0.2", { id: "client:10.0.0.2", kind: "client", label: "b", blocked: false, hits: 5, lastSeen: 1000, forwarded: 20 }],
      ["client:10.0.0.3", { id: "client:10.0.0.3", kind: "client", label: "c", blocked: false, hits: 9, lastSeen: 1000 }],
    ]),
    edges: new Map(),
  } as unknown as GraphState;

  const rows = activeClients(state, 1000);
  expect(rows.map((r) => r.ip)).toEqual(["10.0.0.2", "10.0.0.1", "10.0.0.3"]); // forwarded 20, 3, (0)
  expect(rows.map((r) => r.forwarded)).toEqual([20, 3, 0]); // missing node.forwarded → 0
});
```

(`GraphState` is already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — `r.forwarded` undefined / order wrong.

- [ ] **Step 3: Implement** — in `web/src/lib/clients/active-clients.ts`:

Add `forwarded` to the interface (after `blocked: number;`):
```ts
  forwarded: number;
```

Set it when building each row (read from the node, default 0):
```ts
    rows.push({
      id: node.id,
      ip: node.id.slice("client:".length),
      name: node.label,
      total: t.total,
      blocked: t.blocked,
      forwarded: node.forwarded ?? 0,
      activeNow: nowMs - node.lastSeen < ACTIVE_WINDOW_MS,
    });
```

Change the sort to forwarded desc, tie-break total desc:
```ts
  return rows.sort((a, b) => b.forwarded - a.forwarded || b.total - a.total);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS. The pre-existing "sorted by total desc" test still passes (its fixture nodes have no `forwarded` → all 0 → the `|| b.total - a.total` tie-break yields the same order). If that test's name now reads oddly, you may rename it to "…sorted by forwarded then total"; do not change its assertions.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/clients/active-clients.ts web/test/active-clients.test.ts
git commit -m "feat(web): activeClients exposes forwarded and sorts by it"
```

---

## Task 3: `↑` Unbound column in the client panel

**Files:**
- Modify: `web/src/lib/clients/ClientsList.svelte`

**READ the current `ClientsList.svelte` first.** Current shape: each row is a `.row` grid
with `.dot`, a `.who` span (`.name` + optional `.ip`), and a `.metrics` span. In the
**Aktiv** tab the `.metrics` contains a `{#key …}`-wrapped `.blk` (pulsing block count) +
a `.pct`. In the **24h** tab `.metrics` contains a static `.blk` + `.pct`. `fmt` and `pct`
helpers exist; `ActiveClient` now has `forwarded` (Task 2).

- [ ] **Step 1: Aktiv tab — add the forwarded cell** as the FIRST child of the Aktiv row's `.metrics` span (before the `.blk`):
```svelte
            <span class="fwd" title="an Unbound forwarded (recursed)">↑{fmt(c.forwarded)}</span>
```

- [ ] **Step 2: 24h tab — add a placeholder cell** as the FIRST child of the 24h row's `.metrics` span (before its `.blk`), since the 24h list has no forward split:
```svelte
            <span class="fwd none" title="kein Cache/Unbound-Split in der 24h-Statistik">↑ –</span>
```

- [ ] **Step 3: Style the column** — add to the `<style>` block (next to the `.blk`/`.pct` rules):
```css
  .fwd { color: var(--forwarded); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
  .fwd.none { color: var(--text-dim); }
```

- [ ] **Step 4: Type-check, build, test**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: all green. (`c.forwarded` exists on `ActiveClient`; the 24h `$clients24h` items have no `forwarded` and the placeholder doesn't read one, so no type error there.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/clients/ClientsList.svelte
git commit -m "feat(web): show per-client Unbound (forwarded) column in the client panel"
```

---

## Task 4: Verify + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm test` (root) then `cd web && npm run build`
Expected: all suites pass, build clean.

- [ ] **Step 2: Local visual QA**

Open `http://localhost:5173`, click the top-left `Clients` metric, Aktiv tab: each row
shows an amber `↑ <n>` next to the block count + %, and rows are ordered with the
highest-Unbound clients on top. Switch to **Alle 24h**: the column shows a dim `↑ –`.
Switch themes → the amber follows `--forwarded`.

- [ ] **Step 3: Deploy to the Pi**

Per `deploy-pipeline` project memory:
1. Snapshot + force-push (user runs): `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force`
2. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main && docker-compose up -d --build --force-recreate`
3. Verify HTTP 200 at `:8089` and that the served bundle contains the `↑`/`.fwd` markers.

- [ ] **Step 4: Update CHANGELOG**

Add under `## [Unreleased]` (or a version bump) in `CHANGELOG.md`:
```
### Added
- Per-client Unbound column: the client panel's Aktiv tab shows how many queries
  each client recursed via Unbound (amber ↑ count) and sorts by it; the 24h tab
  shows "↑ –" (Pi-hole top_clients has no cache/forward split).
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for per-client Unbound column"
```

---

## Self-Review notes

- **Spec coverage:** forwarded count (Task 1), tick preservation (Task 1 test), activeClients forwarded + sort (Task 2), Aktiv `↑ n` amber column (Task 3), 24h `↑ –` (Task 3), theme color reuse (`--forwarded`, Task 3). ✓
- **Type consistency:** `GraphNode.forwarded?` (Task 1) read by `activeClients` (Task 2) into `ActiveClient.forwarded`, consumed in ClientsList (Task 3); `resolutionOrigin` reused from `lib/hud`. ✓
- **No new data source / no 24h split** — by design; 24h placeholder is static.
- **Non-breaking:** `forwarded?` optional on GraphNode (existing node literals/tests unaffected); the sort tie-break keeps the existing active-clients test's order.
