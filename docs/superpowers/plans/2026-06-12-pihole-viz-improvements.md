# pihole-viz Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain clustering (collapsible eTLD+1 super-nodes), a floating detail card on click, a theme switcher (Obsidian/Aurora/Nord), and Docker hosting on the Raspi to the existing pihole-viz.

**Architecture:** The immutable `GraphStore` stays the raw source of truth. Clustering is a **pure view transform** (`clusterView`) between store and renderer, driven by an `expandedGroups` set. The detail card reads pure stats derived from the graph and follows a node's live screen position. Theming is a palette registry + a persisted Svelte store that recolours both CSS (HUD/cards) and the Pixi renderer. Docker packages the existing server (which already serves the built frontend + SSE) and is deployed via a private GitHub remote.

**Tech Stack:** TypeScript, Svelte 5, Pixi.js v8, d3-force, Vitest, `tldts` (new), Docker + docker-compose.

**Spec:** `docs/superpowers/specs/2026-06-12-pihole-viz-improvements-design.md`

**Phases are independently shippable.** Build order: 1) Clustering → 2) Detail card → 3) Theming → 4) Docker.

---

## Phase 1 — Domain Clustering

### Task 1: Add `tldts` and `groupSize`/`status` to the graph model

**Files:**
- Modify: `web/package.json` (add `tldts` dependency)
- Modify: `web/src/lib/graph/store.ts` (add fields + persist status)
- Test: `web/test/graph-store.test.ts` (extend)

- [ ] **Step 1: Add a failing test for `status` on domain nodes** — append to `web/test/graph-store.test.ts` inside the existing `describe("GraphStore", ...)`:

```ts
  it("records the latest status on a domain node", () => {
    const g = applyQuery(emptyGraph(), q("ads.com", { status: "GRAVITY", blocked: true }), 1000);
    expect(g.nodes.get("domain:ads.com")!.status).toBe("GRAVITY");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -w web -- graph-store`
Expected: FAIL (`status` is `undefined`).

- [ ] **Step 3: Add the fields and persist status** — in `web/src/lib/graph/store.ts`, extend `GraphNode` (add two optional fields after `opacity`):

```ts
export interface GraphNode {
  id: string;
  kind: "client" | "domain";
  label: string;
  blocked: boolean;
  hits: number;
  lastSeen: number;
  opacity: number;
  /** Pi-hole-Status der letzten Query (nur Domain-Knoten), z.B. "GRAVITY". */
  status?: string;
  /** Anzahl Subdomains, wenn dies ein Cluster-Super-Knoten ist. */
  groupSize?: number;
}
```

In `applyQuery`, set `status` on the domain node — replace the `nodes.set(dId, {...})` block with:

```ts
  const domain = nodes.get(dId);
  nodes.set(dId, {
    id: dId,
    kind: "domain",
    label: query.domain,
    blocked: (domain?.blocked ?? false) || query.blocked,
    hits: (domain?.hits ?? 0) + 1,
    lastSeen: now,
    opacity: 1,
    status: query.status,
  });
```

- [ ] **Step 4: Add `tldts` to web deps** — in `web/package.json`, add to `dependencies` (keep alphabetical):

```json
    "tldts": "^6.1.0",
```

Then run: `cd ~/dev/pihole-viz && npm install`
Expected: installs; if the supply-chain release-age guard blocks `^6.1.0`, pin the newest version that satisfies the guard (e.g. an older 6.x) and note it.

- [ ] **Step 5: Run tests + typecheck — expect PASS**

Run: `npm test -w web -- graph-store && npx tsc -p web/tsconfig.json`
Expected: graph-store tests PASS (8), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json package-lock.json web/src/lib/graph/store.ts web/test/graph-store.test.ts
git commit -m "feat(web): add tldts and status/groupSize fields to graph model"
```

---

### Task 2: `clusterView` transform (collapse/expand by registrable domain)

**Files:**
- Create: `web/src/lib/graph/cluster.ts`
- Test: `web/test/cluster.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/cluster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import { applyQuery, emptyGraph, type GraphState } from "../src/lib/graph/store.js";
import { clusterView } from "../src/lib/graph/cluster.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return {
    type: "query",
    id: Math.floor(Math.random() * 1e9),
    time: 0,
    domain,
    clientIp: "10.0.0.1",
    clientName: "pc",
    blocked: false,
    status: "FORWARDED",
    ...opts,
  };
}

function build(domains: Array<[string, Partial<QueryEvent>?]>): GraphState {
  let g = emptyGraph();
  let t = 1000;
  for (const [d, opts] of domains) g = applyQuery(g, q(d, opts), (t += 1000));
  return g;
}

describe("clusterView", () => {
  const NONE = new Set<string>();

  it("collapses 2+ subdomains of the same registrable domain into one super-node", () => {
    const view = clusterView(build([["api.spotify.com"], ["accounts.spotify.com"]]), NONE);
    const group = view.nodes.get("group:spotify.com");
    expect(group).toMatchObject({ kind: "domain", label: "spotify.com", groupSize: 2, hits: 2 });
    expect(view.nodes.has("domain:api.spotify.com")).toBe(false);
    // one aggregated client -> group edge
    expect(view.edges.get("client:10.0.0.1->group:spotify.com")).toMatchObject({ hits: 2 });
  });

  it("leaves a single-subdomain registrable domain untouched", () => {
    const view = clusterView(build([["heise.de"]]), NONE);
    expect(view.nodes.has("domain:heise.de")).toBe(true);
    expect(view.nodes.has("group:heise.de")).toBe(false);
  });

  it("marks a group blocked when any subdomain was blocked", () => {
    const view = clusterView(
      build([["a.tiktok.com"], ["ads.tiktok.com", { blocked: true }]]),
      NONE,
    );
    expect(view.nodes.get("group:tiktok.com")!.blocked).toBe(true);
  });

  it("expands a group into anchor + subdomains with group->subdomain edges", () => {
    const view = clusterView(
      build([["api.spotify.com"], ["accounts.spotify.com"]]),
      new Set(["spotify.com"]),
    );
    expect(view.nodes.has("group:spotify.com")).toBe(true);
    expect(view.nodes.has("domain:api.spotify.com")).toBe(true);
    expect(view.nodes.has("domain:accounts.spotify.com")).toBe(true);
    expect(view.edges.get("group:spotify.com->domain:api.spotify.com")).toBeTruthy();
    // client still connects to the group anchor, not the subdomains
    expect(view.edges.get("client:10.0.0.1->group:spotify.com")).toBeTruthy();
    expect(view.edges.has("client:10.0.0.1->domain:api.spotify.com")).toBe(false);
  });

  it("keeps a domain without a registrable domain (PTR/arpa) as its own node", () => {
    const view = clusterView(build([["1.0.0.127.in-addr.arpa"]]), NONE);
    expect(view.nodes.has("domain:1.0.0.127.in-addr.arpa")).toBe(true);
    expect([...view.nodes.keys()].some((k) => k.startsWith("group:"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -w web -- cluster`
Expected: FAIL (`cluster.js` not found).

- [ ] **Step 3: Implement** — create `web/src/lib/graph/cluster.ts`:

```ts
import { getDomain } from "tldts";
import type { GraphEdge, GraphNode, GraphState } from "./store.js";

/**
 * Reine View-Transformation: gruppiert Domain-Knoten nach registrierbarer
 * Domain (eTLD+1). Gruppen mit ≥2 Subdomains werden zu einem Super-Knoten
 * `group:<registrable>` zusammengefasst; ist die Gruppe in `expanded`, bleibt
 * der Anker plus die Subdomains als Mini-Hub sichtbar. Clients hängen immer am
 * Gruppen-Anker (aggregierte Kante).
 */
export function clusterView(state: GraphState, expanded: ReadonlySet<string>): GraphState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  // registrierbare Domain je Domain-Knoten + Gruppierung
  const groups = new Map<string, GraphNode[]>();
  for (const node of state.nodes.values()) {
    if (node.kind === "client") {
      nodes.set(node.id, node);
      continue;
    }
    const reg = getDomain(node.label) ?? node.label;
    const arr = groups.get(reg) ?? [];
    arr.push(node);
    groups.set(reg, arr);
  }

  // Domain-Knoten-id → Ziel-id im View (eigene id oder Gruppen-id)
  const targetOf = new Map<string, string>();

  for (const [reg, members] of groups) {
    if (members.length === 1) {
      const only = members[0];
      nodes.set(only.id, only);
      targetOf.set(only.id, only.id);
      continue;
    }
    const groupId = `group:${reg}`;
    const blockedMember = members.find((m) => m.blocked);
    const anchor: GraphNode = {
      id: groupId,
      kind: "domain",
      label: reg,
      blocked: blockedMember !== undefined,
      hits: members.reduce((s, m) => s + m.hits, 0),
      lastSeen: Math.max(...members.map((m) => m.lastSeen)),
      opacity: Math.max(...members.map((m) => m.opacity)),
      status: (blockedMember ?? members[0]).status,
      groupSize: members.length,
    };
    nodes.set(groupId, anchor);
    for (const m of members) targetOf.set(m.id, groupId);

    if (expanded.has(reg)) {
      for (const m of members) {
        nodes.set(m.id, m);
        const eid = `${groupId}->${m.id}`;
        edges.set(eid, {
          id: eid,
          source: groupId,
          target: m.id,
          hits: m.hits,
          lastSeen: m.lastSeen,
          blocked: m.blocked,
        });
      }
    }
  }

  // Client→Domain-Kanten auf das View-Ziel umschreiben + aggregieren
  for (const edge of state.edges.values()) {
    const target = targetOf.get(edge.target) ?? edge.target;
    const eid = `${edge.source}->${target}`;
    const prev = edges.get(eid);
    if (prev) {
      edges.set(eid, {
        ...prev,
        hits: prev.hits + edge.hits,
        blocked: prev.blocked || edge.blocked,
        lastSeen: Math.max(prev.lastSeen, edge.lastSeen),
      });
    } else {
      edges.set(eid, { id: eid, source: edge.source, target, hits: edge.hits, lastSeen: edge.lastSeen, blocked: edge.blocked });
    }
  }

  return { nodes, edges, droppedDomains: state.droppedDomains };
}
```

- [ ] **Step 4: Run tests + typecheck — expect PASS**

Run: `npm test -w web -- cluster && npx tsc -p web/tsconfig.json`
Expected: 5 cluster tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/graph/cluster.ts web/test/cluster.test.ts
git commit -m "feat(web): clusterView transform groups domains by registrable domain"
```

---

### Task 3: Render group count badge + wire clustering into App

**Files:**
- Modify: `web/src/lib/render/renderer.ts` (badge per node)
- Modify: `web/src/App.svelte` (clusterView + expandedGroups + group click)

- [ ] **Step 1: Add a count badge to node visuals** — in `web/src/lib/render/renderer.ts`, extend the `NodeVisual` interface (add `badge: Text` after `label`):

```ts
interface NodeVisual {
  root: Container;
  core: Graphics;
  label: Text;
  badge: Text;
  pulse: number;
  lastHits: number;
  coreRadius: number;
  coreColor: number;
}
```

In `syncVisuals`, where the visual is created, add a badge Text and include it in the visual. Replace the node-creation block (from `const label = new Text({...})` through `this.visuals.set(node.id, visual);`) with:

```ts
        const label = new Text({
          text: node.label,
          style: {
            fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
            fontSize: node.kind === "client" ? 13 : 10,
            fill: node.kind === "client" ? COLORS.labelClient : COLORS.labelDomain,
          },
        });
        label.anchor.set(0.5, 1);
        const badge = new Text({
          text: "",
          style: { fontFamily: "-apple-system, sans-serif", fontSize: 9, fontWeight: "700", fill: COLORS.background },
        });
        badge.anchor.set(0.5, 0.5);
        root.addChild(core, label, badge);
        root.eventMode = "static";
        root.cursor = "pointer";
        root.on("pointerover", (e) =>
          this.callbacks.onHover?.(node.id, e.global.x, e.global.y),
        );
        root.on("pointerout", () => this.callbacks.onHover?.(null, 0, 0));
        root.on("pointertap", () => this.callbacks.onTap?.(node.id));
        root.on("pointerdown", (e) => this.startDrag(node.id, e));
        this.nodeLayer.addChild(root);
        visual = { root, core, label, badge, pulse: 0, lastHits: 0, coreRadius: -1, coreColor: -1 };
        this.visuals.set(node.id, visual);
```

In `frame()`, inside the node loop after the label block, add badge handling:

```ts
      // Cluster-Anzahl-Badge (nur Super-Knoten), bildschirmgroß und mittig.
      if (node.groupSize && node.groupSize > 1) {
        visual.badge.text = String(node.groupSize);
        visual.badge.visible = true;
        visual.badge.scale.set(1 / worldScale);
      } else {
        visual.badge.visible = false;
      }
```

- [ ] **Step 2: Wire clustering into App** — in `web/src/App.svelte`, add the import and the expand state, and route clicks. Change the import line for the store:

```ts
  import { applyQuery, emptyGraph, tick } from "./lib/graph/store.js";
  import { clusterView } from "./lib/graph/cluster.js";
```

Inside `onMount`, after `let graph = emptyGraph();` add:

```ts
    const expandedGroups = new Set<string>();
    const render = () => renderer.update(clusterView(graph, expandedGroups));
```

Replace the renderer construction's `onTap` and the two `renderer.update(graph)` call sites and the decay timer to use `render()`. The renderer is created as:

```ts
    const renderer = new GraphRenderer({
      onHover(nodeId, x, y) {
        tooltip = nodeId ? { text: nodeId.replace(/^(client|domain|group):/, ""), x, y } : null;
      },
      onTap(nodeId) {
        if (nodeId.startsWith("group:")) {
          const reg = nodeId.slice("group:".length);
          if (expandedGroups.has(reg)) expandedGroups.delete(reg);
          else expandedGroups.add(reg);
          render();
          return;
        }
        highlighted = highlighted === nodeId ? null : nodeId;
        renderer.setHighlight(highlighted);
      },
    });
```

In `onEvent`, replace `renderer.update(graph);` with `render();`. In `decayTimer`, replace `renderer.update(graph);` with `render();`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p web/tsconfig.json && npm run build -w web`
Expected: clean, build succeeds.

- [ ] **Step 4: Manual smoke (live)**

Run: ensure server runs (`npm run dev:server`), then `npm run dev:web`, open `http://localhost:5173`.
Checklist:
- Domains of the same registrable domain collapse into one node with a number badge.
- Click a group node → it expands into subdomains hanging off the anchor; the badge stays on the anchor.
- Click again → collapses back.
- Single-subdomain domains stay individual.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/render/renderer.ts web/src/App.svelte
git commit -m "feat(web): render cluster badges and toggle expand on group click"
```

---

## Phase 2 — Detail Card

### Task 4: `stats.ts` — derive card data from the graph

**Files:**
- Create: `web/src/lib/detail/stats.ts`
- Test: `web/test/stats.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import { applyQuery, emptyGraph, type GraphState } from "../src/lib/graph/store.js";
import { nodeDetails } from "../src/lib/detail/stats.js";

function q(domain: string, opts: Partial<QueryEvent> = {}): QueryEvent {
  return { type: "query", id: Math.floor(Math.random() * 1e9), time: 0, domain, clientIp: "10.0.0.1", clientName: "pc", blocked: false, status: "FORWARDED", ...opts };
}
function build(qs: QueryEvent[]): GraphState {
  let g = emptyGraph();
  let t = 1000;
  for (const query of qs) g = applyQuery(g, query, (t += 1000));
  return g;
}

describe("nodeDetails", () => {
  it("summarises a client: top domains, totals, blocked", () => {
    const g = build([q("a.com"), q("a.com"), q("ads.com", { blocked: true }), q("b.com")]);
    const d = nodeDetails(g, "client:10.0.0.1");
    expect(d?.kind).toBe("client");
    if (d?.kind !== "client") throw new Error("expected client");
    expect(d.label).toBe("pc");
    expect(d.totalQueries).toBe(4);
    expect(d.blockedQueries).toBe(1);
    expect(d.topDomains[0]).toMatchObject({ domain: "a.com", hits: 2 });
    expect(d.topDomains.length).toBeLessThanOrEqual(6);
  });

  it("summarises a domain: querying clients, blocked + status", () => {
    let g = build([q("ads.com", { blocked: true, status: "GRAVITY" })]);
    g = applyQuery(g, q("ads.com", { clientIp: "10.0.0.2", clientName: "tv", blocked: true, status: "GRAVITY" }), 9000);
    const d = nodeDetails(g, "domain:ads.com");
    expect(d?.kind).toBe("domain");
    if (d?.kind !== "domain") throw new Error("expected domain");
    expect(d.blocked).toBe(true);
    expect(d.status).toBe("GRAVITY");
    expect(d.clients.map((c) => c.client).sort()).toEqual(["pc", "tv"]);
  });

  it("returns null for an unknown id", () => {
    expect(nodeDetails(emptyGraph(), "client:nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -w web -- stats`
Expected: FAIL (`stats.js` not found).

- [ ] **Step 3: Implement** — create `web/src/lib/detail/stats.ts`:

```ts
import type { GraphState } from "../graph/store.js";

export interface DomainHit {
  domain: string;
  hits: number;
  blocked: boolean;
}
export interface ClientHit {
  client: string;
  hits: number;
}

export interface ClientDetails {
  kind: "client";
  id: string;
  label: string;
  ip: string;
  totalQueries: number;
  blockedQueries: number;
  topDomains: DomainHit[];
  lastSeen: number;
}

export interface DomainDetails {
  kind: "domain";
  id: string;
  label: string;
  blocked: boolean;
  status?: string;
  totalQueries: number;
  clients: ClientHit[];
  groupSize?: number;
  lastSeen: number;
}

export type NodeDetails = ClientDetails | DomainDetails;

const TOP_N = 6;

export function nodeDetails(state: GraphState, id: string): NodeDetails | null {
  const node = state.nodes.get(id);
  if (!node) return null;

  if (node.kind === "client") {
    const own = [...state.edges.values()].filter((e) => e.source === id);
    const topDomains: DomainHit[] = own
      .map((e) => ({ domain: state.nodes.get(e.target)?.label ?? e.target, hits: e.hits, blocked: e.blocked }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, TOP_N);
    return {
      kind: "client",
      id,
      label: node.label,
      ip: id.slice("client:".length),
      totalQueries: own.reduce((s, e) => s + e.hits, 0),
      blockedQueries: own.filter((e) => e.blocked).reduce((s, e) => s + e.hits, 0),
      topDomains,
      lastSeen: node.lastSeen,
    };
  }

  const incoming = [...state.edges.values()].filter((e) => e.target === id);
  const clients: ClientHit[] = incoming
    .map((e) => ({ client: state.nodes.get(e.source)?.label ?? e.source, hits: e.hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, TOP_N);
  return {
    kind: "domain",
    id,
    label: node.label,
    blocked: node.blocked,
    status: node.status,
    totalQueries: node.hits,
    clients,
    groupSize: node.groupSize,
    lastSeen: node.lastSeen,
  };
}
```

- [ ] **Step 4: Run tests + typecheck — expect PASS**

Run: `npm test -w web -- stats && npx tsc -p web/tsconfig.json`
Expected: 3 stats tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/detail/stats.ts web/test/stats.test.ts
git commit -m "feat(web): derive detail-card stats from graph state"
```

---

### Task 5: Selection store + `screenPosition` on the renderer

**Files:**
- Create: `web/src/lib/detail/selection-store.ts`
- Modify: `web/src/lib/render/renderer.ts` (add `screenPosition`, background-tap callback)
- Test: `web/test/selection-store.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/selection-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { clearSelection, selectNode, selectedId } from "../src/lib/detail/selection-store.js";

describe("selection store", () => {
  beforeEach(() => clearSelection());

  it("selects and clears a node id", () => {
    selectNode("client:10.0.0.1");
    expect(get(selectedId)).toBe("client:10.0.0.1");
    clearSelection();
    expect(get(selectedId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -w web -- selection-store`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store** — create `web/src/lib/detail/selection-store.ts`:

```ts
import { writable } from "svelte/store";

/** id des aktuell gewählten Knotens (client:/domain:/group:) oder null. */
export const selectedId = writable<string | null>(null);

export function selectNode(id: string): void {
  selectedId.set(id);
}

export function clearSelection(): void {
  selectedId.set(null);
}
```

- [ ] **Step 4: Add `screenPosition` + background tap to the renderer** — in `web/src/lib/render/renderer.ts`, extend `RendererCallbacks`:

```ts
export interface RendererCallbacks {
  onHover?: (nodeId: string | null, x: number, y: number) => void;
  onTap?: (nodeId: string) => void;
  onBackgroundTap?: () => void;
}
```

In `init()`, after the existing `this.app.stage.on("pointerupoutside", ...)` line, add a background-tap handler:

```ts
    this.app.stage.on("pointertap", (e) => {
      if (e.target === this.app.stage) this.callbacks.onBackgroundTap?.();
    });
```

Add a public method (next to `worldContainer` getter):

```ts
  /** Aktuelle Bildschirmposition (Canvas-Pixel) eines Knotens, oder null. */
  screenPosition(id: string): { x: number; y: number } | null {
    const p = this.sim?.position(id);
    if (!p) return null;
    const g = this.world.toGlobal({ x: p.x, y: p.y });
    return { x: g.x, y: g.y };
  }
```

- [ ] **Step 5: Run tests + typecheck — expect PASS**

Run: `npm test -w web -- selection-store && npx tsc -p web/tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/detail/selection-store.ts web/src/lib/render/renderer.ts web/test/selection-store.test.ts
git commit -m "feat(web): selection store and renderer screenPosition + background tap"
```

---

### Task 6: `DetailCard.svelte` + App wiring

**Files:**
- Create: `web/src/lib/detail/DetailCard.svelte`
- Modify: `web/src/App.svelte`

- [x] **Step 1: Create the card component** — `web/src/lib/detail/DetailCard.svelte`:

```svelte
<script lang="ts">
  import type { GraphState } from "../graph/store.js";
  import type { GraphRenderer } from "../render/renderer.js";
  import { nodeDetails, type NodeDetails } from "./stats.js";
  import { selectedId, clearSelection } from "./selection-store.js";

  let { renderer, getGraph }: { renderer: GraphRenderer; getGraph: () => GraphState } = $props();

  let pos = $state<{ x: number; y: number } | null>(null);
  let details = $state<NodeDetails | null>(null);

  // Folgt der Live-Position des gewählten Knotens; schließt, wenn er weg ist.
  $effect(() => {
    const id = $selectedId;
    if (!id) {
      pos = null;
      details = null;
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = renderer.screenPosition(id);
      const d = nodeDetails(getGraph(), id);
      if (!p || !d) {
        clearSelection();
        return;
      }
      pos = p;
      details = d;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  // Am rechten Rand nach links kippen.
  let flip = $derived(pos !== null && pos.x > window.innerWidth - 260);
</script>

{#if details && pos}
  <div
    class="card"
    class:flip
    style="left: {pos.x}px; top: {pos.y}px"
  >
    <button class="close" onclick={() => clearSelection()} aria-label="schließen">✕</button>
    {#if details.kind === "client"}
      <div class="name">{details.label}</div>
      <div class="sub">{details.ip} · Client</div>
      <div class="row"><span>Queries</span><b>{details.totalQueries}</b></div>
      <div class="row"><span>Geblockt</span><b class="blocked">{details.blockedQueries}</b></div>
      <div class="label">Top-Domains</div>
      <ul>
        {#each details.topDomains as d (d.domain)}
          <li class:blocked={d.blocked}><span>{d.domain}</span><span>{d.hits}</span></li>
        {/each}
      </ul>
    {:else}
      <div class="name">{details.label}</div>
      <div class="sub">
        {details.groupSize ? `Gruppe · ${details.groupSize} Subdomains` : "Domain"}
        {#if details.blocked} · <span class="blocked">{details.status ?? "geblockt"}</span>{/if}
      </div>
      <div class="row"><span>Queries</span><b>{details.totalQueries}</b></div>
      <div class="label">Clients</div>
      <ul>
        {#each details.clients as c (c.client)}
          <li><span>{c.client}</span><span>{c.hits}</span></li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .card {
    position: fixed;
    transform: translate(16px, -50%);
    min-width: 200px;
    max-width: 240px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    padding: 12px 14px;
    backdrop-filter: blur(8px);
    z-index: 25;
    font-family: -apple-system, "SF Pro Text", sans-serif;
  }
  .card.flip { transform: translate(calc(-100% - 16px), -50%); }
  .close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px; }
  .name { font-size: 14px; font-weight: 600; color: var(--text); }
  .sub { font-size: 10px; color: var(--text-dim); margin-bottom: 8px; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin: 2px 0; }
  .row b { font-variant-numeric: tabular-nums; }
  .blocked { color: var(--blocked); }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin: 8px 0 4px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  li { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; font-family: ui-monospace, "SF Mono", monospace; color: var(--text); }
  li.blocked span:first-child { color: var(--blocked); text-decoration: line-through; }
</style>
```

- [x] **Step 2: Wire the card + selection into App** — in `web/src/App.svelte`, add imports:

```ts
  import DetailCard from "./lib/detail/DetailCard.svelte";
  import { selectNode, clearSelection } from "./lib/detail/selection-store.js";
```

Update `onTap` to also select, and add `onBackgroundTap`. Replace the `onTap` body and add the new callback:

```ts
      onTap(nodeId) {
        if (nodeId.startsWith("group:")) {
          const reg = nodeId.slice("group:".length);
          if (expandedGroups.has(reg)) expandedGroups.delete(reg);
          else expandedGroups.add(reg);
          render();
          selectNode(nodeId);
          return;
        }
        highlighted = highlighted === nodeId ? null : nodeId;
        renderer.setHighlight(highlighted);
        if (highlighted) selectNode(nodeId);
        else clearSelection();
      },
      onBackgroundTap() {
        highlighted = null;
        renderer.setHighlight(null);
        clearSelection();
      },
```

Expose the renderer + a graph getter to the template. The `renderer` is local to `onMount`; lift it so the template can use it. `GraphRenderer` is **already imported** at the top of `App.svelte` (don't add a duplicate import). Add a top-level reactive declaration:

```ts
  let renderer = $state<GraphRenderer | null>(null);
```

Inside `onMount`, change `const renderer = new GraphRenderer({...})` to `renderer = new GraphRenderer({...})` (assign the outer var). Because `renderer` is now nullable, change `render` (from Task 3) to guard:

```ts
    const render = () => renderer?.update(clusterView(graph, expandedGroups));
```

Add a graph getter the card can read (closes over the `graph` `let`, always returns the latest value). Add near the top of `onMount`:

```ts
    const graphRef = { get: () => graph };
```

Then render the card after `<Hud />` in the markup:

```svelte
{#if renderer}
  <DetailCard {renderer} getGraph={graphRef.get} />
{/if}
```

Note: `graphRef.get` closes over the `graph` `let`, so it always returns the latest value.

- [x] **Step 3: Typecheck + build**

Run: `npx tsc -p web/tsconfig.json && npm run build -w web`
Expected: clean, build succeeds.

- [x] **Step 4: Manual smoke (live)**

Open `http://localhost:5173`:
- Click a client → card appears next to it with name/IP, totals, top domains; follows the node as it moves.
- Click a domain → card with querying clients + blocked status.
- Click a group → expands AND shows a group card (subdomain count).
- Click empty space → card closes, highlight clears.
- Near the right edge the card flips to the left.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/detail/DetailCard.svelte web/src/App.svelte
git commit -m "feat(web): floating detail card on node click"
```

---

## Phase 3 — Theming

### Task 7: Theme registry + persisted store

**Files:**
- Create: `web/src/lib/theme/themes.ts`
- Create: `web/src/lib/theme/theme-store.ts`
- Test: `web/test/theme-store.test.ts`

- [ ] **Step 1: Write the failing test** — create `web/test/theme-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { THEMES, type ThemeId } from "../src/lib/theme/themes.js";

describe("themes registry", () => {
  it("contains all three themes with full token sets", () => {
    const ids: ThemeId[] = ["obsidian", "aurora", "nord"];
    for (const id of ids) {
      const p = THEMES[id];
      expect(p.graph.background).toBeTypeOf("number");
      expect(p.graph.client).toBeTypeOf("number");
      expect(p.css.bg).toMatch(/^#|rgb/);
      expect(p.css.blocked).toMatch(/^#|rgb/);
    }
  });
});

describe("theme store", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to obsidian without a stored value", async () => {
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    expect(get(themeId)).toBe("obsidian");
  });

  it("persists a change to localStorage", async () => {
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    themeId.set("nord");
    expect(localStorage.getItem("pihole-viz-theme")).toBe("nord");
  });

  it("loads a stored value", async () => {
    localStorage.setItem("pihole-viz-theme", "aurora");
    vi.resetModules();
    const { themeId } = await import("../src/lib/theme/theme-store.js");
    expect(get(themeId)).toBe("aurora");
  });
});
```

- [ ] **Step 2: Configure jsdom for this test** — the store uses `localStorage`/`window`, so the test needs the jsdom environment. Add a docblock at the very top of `web/test/theme-store.test.ts`:

```ts
// @vitest-environment jsdom
```

Then ensure `jsdom` is available: add to `web/package.json` devDependencies:

```json
    "jsdom": "^25.0.0",
```

Run: `cd ~/dev/pihole-viz && npm install` (pin older if the release-age guard blocks it).

- [ ] **Step 3: Run it — expect FAIL**

Run: `npm test -w web -- theme-store`
Expected: FAIL (`themes.js` not found).

- [ ] **Step 4: Implement the registry** — create `web/src/lib/theme/themes.ts`:

```ts
export type ThemeId = "obsidian" | "aurora" | "nord";

/** Graph-Farben für den Pixi-Renderer (Pixi nutzt numerische Hex-Werte). */
export interface GraphPalette {
  background: number;
  client: number;
  domainAllowed: number;
  domainBlocked: number;
  edge: number;
  edgeBlockedPulse: number;
  labelClient: number;
  labelDomain: number;
}

/** CSS-Token für HUD/Karten (als Strings für CSS-Variablen). */
export interface CssPalette {
  bg: string;
  panel: string;
  panelBorder: string;
  text: string;
  textDim: string;
  client: string;
  allowed: string;
  blocked: string;
}

export interface Palette {
  graph: GraphPalette;
  css: CssPalette;
}

export const THEMES: Record<ThemeId, Palette> = {
  obsidian: {
    graph: {
      background: 0x0b0d12,
      client: 0xa89df8,
      domainAllowed: 0x86efac,
      domainBlocked: 0xfca5a5,
      edge: 0x2d3344,
      edgeBlockedPulse: 0xf87171,
      labelClient: 0xc4bdfb,
      labelDomain: 0x8b93a8,
    },
    css: {
      bg: "#0b0d12",
      panel: "rgba(22, 26, 34, 0.9)",
      panelBorder: "#2a3040",
      text: "#e8eaf0",
      textDim: "#8b93a8",
      client: "#a89df8",
      allowed: "#86efac",
      blocked: "#fca5a5",
    },
  },
  aurora: {
    graph: {
      background: 0x06080f,
      client: 0x67e8f9,
      domainAllowed: 0x67e8f9,
      domainBlocked: 0xf472b6,
      edge: 0x3b5a8c,
      edgeBlockedPulse: 0xf472b6,
      labelClient: 0xbfdbfe,
      labelDomain: 0x7b8bb0,
    },
    css: {
      bg: "#06080f",
      panel: "rgba(18, 24, 40, 0.9)",
      panelBorder: "#243049",
      text: "#e6edff",
      textDim: "#7b8bb0",
      client: "#67e8f9",
      allowed: "#67e8f9",
      blocked: "#f472b6",
    },
  },
  nord: {
    graph: {
      background: 0x2e3440,
      client: 0x88c0d0,
      domainAllowed: 0xa3be8c,
      domainBlocked: 0xbf616a,
      edge: 0x4c566a,
      edgeBlockedPulse: 0xbf616a,
      labelClient: 0xe5e9f0,
      labelDomain: 0xaab2c0,
    },
    css: {
      bg: "#2e3440",
      panel: "rgba(59, 66, 82, 0.9)",
      panelBorder: "#4c566a",
      text: "#e5e9f0",
      textDim: "#aab2c0",
      client: "#88c0d0",
      allowed: "#a3be8c",
      blocked: "#bf616a",
    },
  },
};
```

- [ ] **Step 5: Implement the store** — create `web/src/lib/theme/theme-store.ts`:

```ts
import { writable } from "svelte/store";
import type { ThemeId } from "./themes.js";

const KEY = "pihole-viz-theme";
const VALID: ThemeId[] = ["obsidian", "aurora", "nord"];

function initial(): ThemeId {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return stored && (VALID as string[]).includes(stored) ? (stored as ThemeId) : "obsidian";
}

export const themeId = writable<ThemeId>(initial());

themeId.subscribe((id) => {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, id);
});
```

- [ ] **Step 6: Run tests + typecheck — expect PASS**

Run: `npm test -w web -- theme-store && npx tsc -p web/tsconfig.json`
Expected: 4 tests PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json package-lock.json web/src/lib/theme/themes.ts web/src/lib/theme/theme-store.ts web/test/theme-store.test.ts
git commit -m "feat(web): theme palette registry and persisted theme store"
```

---

### Task 8: Renderer reads active palette + `setTheme`

**Files:**
- Modify: `web/src/lib/render/renderer.ts`

- [ ] **Step 1: Make the renderer palette-driven** — in `web/src/lib/render/renderer.ts`, replace the `COLORS` import:

```ts
import { THEMES, type GraphPalette } from "../theme/themes.js";
```

Add a field (after `private draggingId ...`):

```ts
  private palette: GraphPalette = THEMES.obsidian.graph;
```

In `init()`, change the `background:` option to `background: this.palette.background,`.

Replace every `COLORS.` reference with `this.palette.`:
- `coreColor()` returns `this.palette.client` / `this.palette.domainBlocked` / `this.palette.domainAllowed`.
- label fill at creation: `node.kind === "client" ? this.palette.labelClient : this.palette.labelDomain`.
- badge fill: `this.palette.background`.
- edge stroke colours in `frame()`: `this.palette.edgeBlockedPulse` and `this.palette.edge`.

Add the `setTheme` method (next to `setHighlight`):

```ts
  setTheme(palette: GraphPalette): void {
    this.palette = palette;
    if (this.app) this.app.renderer.background.color = palette.background;
    for (const visual of this.visuals.values()) {
      visual.coreColor = -1; // erzwingt Neuzeichnen des Kerns im nächsten Frame
      visual.label.style.fill = visual.label.style.fontSize === 13 ? palette.labelClient : palette.labelDomain;
      visual.badge.style.fill = palette.background;
    }
  }
```

Note: label font size distinguishes client (13) vs domain (10), so the fill recolour picks the right token.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -p web/tsconfig.json && npm run build -w web`
Expected: clean. (If `app.renderer.background.color` typing differs in Pixi 8.19, use `this.app.renderer.background.color = palette.background` or the `backgroundColor` setter — adapt minimally and note it.)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/render/renderer.ts
git commit -m "feat(web): renderer reads active palette and supports setTheme"
```

---

### Task 9: Theme switcher control + apply theme app-wide

**Files:**
- Create: `web/src/lib/theme/ThemeSwitcher.svelte`
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Create the switcher** — `web/src/lib/theme/ThemeSwitcher.svelte`:

```svelte
<script lang="ts">
  import { themeId } from "./theme-store.js";
  import type { ThemeId } from "./themes.js";

  const options: { id: ThemeId; label: string }[] = [
    { id: "obsidian", label: "Obsidian" },
    { id: "aurora", label: "Aurora" },
    { id: "nord", label: "Nord" },
  ];
</script>

<div class="switcher">
  {#each options as o (o.id)}
    <button class:active={$themeId === o.id} onclick={() => themeId.set(o.id)}>{o.label}</button>
  {/each}
</div>

<style>
  .switcher {
    position: fixed;
    bottom: 16px;
    right: 140px;
    display: flex;
    gap: 4px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 4px;
    backdrop-filter: blur(8px);
    z-index: 15;
  }
  button {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    font-family: -apple-system, sans-serif;
  }
  button.active { background: var(--panel-border); color: var(--text); }
</style>
```

- [ ] **Step 2: Apply theme app-wide in App** — in `web/src/App.svelte`, add imports:

```ts
  import ThemeSwitcher from "./lib/theme/ThemeSwitcher.svelte";
  import { themeId } from "./lib/theme/theme-store.js";
  import { THEMES } from "./lib/theme/themes.js";
```

Inside `onMount`, after the renderer is created and `render` is defined, subscribe to the theme and apply it (store the unsubscribe for cleanup):

```ts
    const applyTheme = (id: keyof typeof THEMES) => {
      const css = THEMES[id].css;
      const root = document.documentElement.style;
      root.setProperty("--bg", css.bg);
      root.setProperty("--panel", css.panel);
      root.setProperty("--panel-border", css.panelBorder);
      root.setProperty("--text", css.text);
      root.setProperty("--text-dim", css.textDim);
      root.setProperty("--client", css.client);
      root.setProperty("--allowed", css.allowed);
      root.setProperty("--blocked", css.blocked);
      renderer?.setTheme(THEMES[id].graph);
    };
    const unsubTheme = themeId.subscribe((id) => applyTheme(id));
```

Add `unsubTheme();` to the `onMount` cleanup return. Render the switcher after `<Hud />`:

```svelte
<ThemeSwitcher />
```

Note: the theme subscription fires once immediately on subscribe, applying the persisted theme on load. `renderer` may be null on the very first synchronous call (before `init()` resolves); `renderer?.setTheme` guards that, and the CSS variables still apply. After `init()`, call `applyTheme($themeId)` once more — add, right after `renderer = new GraphRenderer({...})` resolves inside the `.then()`:

```ts
      applyTheme(getThemeId());
```

where `getThemeId` reads the current value:

```ts
    let currentTheme: keyof typeof THEMES = "obsidian";
    const getThemeId = () => currentTheme;
```

and update `currentTheme` inside the subscribe callback: `const unsubTheme = themeId.subscribe((id) => { currentTheme = id; applyTheme(id); });`

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p web/tsconfig.json && npm run build -w web`
Expected: clean, build succeeds.

- [ ] **Step 4: Manual smoke (live)**

Open `http://localhost:5173`:
- A theme switcher sits bottom-right; click Aurora/Nord → background, nodes, edges, labels, HUD and cards recolour live.
- Reload → the last theme is remembered.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/theme/ThemeSwitcher.svelte web/src/App.svelte
git commit -m "feat(web): theme switcher applies palette to css and renderer"
```

---

## Phase 4 — Docker Hosting

### Task 10: Dockerfile, compose, dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
**/dist
.git
.superpowers
.env
server/.env
*.log
docs
coverage
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared/ shared/
COPY web/ web/
RUN npm run build -w web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY shared/ shared/
COPY server/ server/
COPY --from=build /app/web/dist web/dist
RUN npm ci --omit=dev
EXPOSE 5641
CMD ["npx", "tsx", "server/src/index.ts"]
```

Note: the server (`server/src/index.ts`) reads config from `process.env` via `loadConfig(process.env)` and serves `../web/dist` relative to its CWD; with WORKDIR `/app` and the server run from `/app`, `serveStatic({ root: "../web/dist" })` resolves to `/web/dist`. **Adjust:** since the container runs from `/app` (not `/app/server`), verify the static root. If 404, change is out-of-scope for this file — see Step 4.

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  pihole-viz:
    build: .
    container_name: pihole-viz
    env_file: .env
    environment:
      PIHOLE_URL: ${PIHOLE_URL:-http://pi.hole}
      PORT: 5641
    ports:
      - "8089:5641"
    restart: unless-stopped
```

- [ ] **Step 4: Fix static-file root for container CWD** — the server runs from `/app` in the container but from `server/` locally (`npm start` sets CWD to repo root via workspace, actually tsx runs from repo root). Verify `server/src/index.ts` line `app.use("/*", serveStatic({ root: "../web/dist" }))`. In the container, CWD is `/app`, so `../web/dist` would be `/web/dist` (wrong). Make the root CWD-independent: change that line to resolve from the repo root. Edit `server/src/index.ts`:

```ts
app.use("/*", serveStatic({ root: "./web/dist" }));
```

And keep local dev working: locally `npm start` runs with CWD = repo root (npm workspace command runs from the workspace dir `server/`). To be robust in both, set the Docker CMD working directory and the local script consistently. Simplest robust fix: run the server with CWD = repo root in both. The local `server` script is `tsx --env-file=.env src/index.ts` with CWD `server/`. Change `server/package.json` `start`/`dev` to run from repo root is invasive; instead make the static root absolute via an env var with a sensible default:

```ts
const webDist = process.env.WEB_DIST ?? "../web/dist";
app.use("/*", serveStatic({ root: webDist }));
```

Set `WEB_DIST=./web/dist` in the Dockerfile runtime stage (`ENV WEB_DIST=./web/dist`). Local dev keeps the `../web/dist` default. Add the `ENV WEB_DIST=./web/dist` line to the runtime stage of the Dockerfile (after `ENV NODE_ENV=production`).

- [ ] **Step 5: Build locally to verify**

Run: `cd ~/dev/pihole-viz && docker compose build`
Expected: build completes (multi-stage). Then a smoke run against the real Pi-hole:

```bash
PIHOLE_URL=http://pi.hole PIHOLE_PASSWORD="$(grep PIHOLE_PASSWORD server/.env | cut -d= -f2)" docker compose up -d
sleep 5
curl -s http://localhost:8089/api/summary
curl -s http://localhost:8089/ | head -5
docker compose down
```

Expected: summary JSON with real numbers; `/` returns the built `index.html`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore server/src/index.ts
git commit -m "feat: dockerise pihole-viz with multi-stage build and compose"
```

---

### Task 11: Private GitHub remote + deployment docs

**Files:**
- Modify: `README.md` (deployment section)
- Create: private GitHub repo, push

- [ ] **Step 1: Create the private remote and push**

Run:

```bash
cd ~/dev/pihole-viz
gh repo create pihole-viz --private --source=. --remote=origin --push
```

Expected: repo `<user>/pihole-viz` created private, `main` pushed. Confirm: `gh repo view --json visibility -q .visibility` → `PRIVATE`.

- [ ] **Step 2: Add a deployment section to `README.md`** — append:

```markdown
## Deployment (Raspi / Docker)

The server serves the built frontend, so one container is enough.

On the Pi (Docker host):

```bash
git clone git@github.com:<user>/pihole-viz.git
cd pihole-viz
cp server/.env.example .env          # compose reads .env at the repo root
# set PIHOLE_PASSWORD (app password) and PIHOLE_URL=http://pi.hole in .env
docker compose up -d --build
```

Open `http://<pi-ip>:8089`. Update with `git pull && docker compose up -d --build`.
```

Note: compose reads `.env` from the repo root (not `server/.env`); the deployment copies the example there.

- [ ] **Step 3: Verify the .env path** — confirm `.gitignore` ignores root `.env` (it does: `.env` pattern). The deployment `.env` at repo root is gitignored.

- [ ] **Step 4: Commit + push**

```bash
git add README.md
git commit -m "docs: add raspi/docker deployment instructions"
git push
```

- [ ] **Step 5: Final full verification**

Run: `npm test && npx tsc -p web/tsconfig.json && npx tsc -p server/tsconfig.json && npx tsc -p shared/tsconfig.json && npm run build -w web`
Expected: all tests green (shared + server + web incl. cluster/stats/selection/theme), all typechecks clean, build succeeds.
