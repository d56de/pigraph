# Mobile-Responsive HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HUD responsive below 600px — metrics + donut stay (compact), the live feed collapses to a "● Live" pill, the clients card and all panels cap to the viewport, and the controls reflow into one flex container; desktop is unchanged.

**Architecture:** Pure CSS `@media (max-width: 600px)` rules drive the mobile layout; one new ephemeral `feedOpen` store + a pill button toggle the collapsed feed. The three corner controls move into a `Controls.svelte` flex container (replacing three hardcoded `right:` offsets), and the theme switcher condenses on mobile. Frontend-only.

**Tech Stack:** Svelte 5 runes, CSS media queries, Vitest.

Spec: `docs/superpowers/specs/2026-06-18-mobile-responsive-hud-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `web/src/lib/hud/feed-store.ts` (new) | `feedOpen` writable + `toggleFeed()` (ephemeral) |
| `web/src/lib/controls/Controls.svelte` (new) | fixed flex container wrapping the 3 controls |
| `web/src/App.svelte` | render `<Controls/>` instead of the 3 separate controls |
| `web/src/lib/theme/ThemeSwitcher.svelte` | drop own positioning; mobile-compact (O/A/N) |
| `web/src/lib/filter/PtrToggle.svelte` | drop own positioning (flex child) |
| `web/src/lib/auth/LogoutButton.svelte` | drop own positioning (flex child) |
| `web/src/lib/hud/Hud.svelte` | mobile media queries: cap widths, compact metrics/donut, feed→pill, clients card cap |

---

## Task 1: feed-store

**Files:**
- Create: `web/src/lib/hud/feed-store.ts`
- Test: `web/test/feed-store.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `web/test/feed-store.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import { feedOpen, toggleFeed, closeFeed } from "../src/lib/hud/feed-store.js";

describe("feed-store", () => {
  beforeEach(() => closeFeed());

  it("defaults to closed", () => {
    expect(get(feedOpen)).toBe(false);
  });
  it("toggleFeed flips the state", () => {
    toggleFeed();
    expect(get(feedOpen)).toBe(true);
    toggleFeed();
    expect(get(feedOpen)).toBe(false);
  });
  it("closeFeed forces closed", () => {
    toggleFeed();
    closeFeed();
    expect(get(feedOpen)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web`
Expected: FAIL — module `../src/lib/hud/feed-store.js` not found.

- [ ] **Step 3: Implement** — create `web/src/lib/hud/feed-store.ts` (mirrors `clients-panel-store.ts`):
```ts
import { writable } from "svelte/store";

/** Ist der Live-Feed auf Mobile aufgeklappt? Nicht persistiert (jedes Laden zu). */
export const feedOpen = writable(false);

export function toggleFeed(): void {
  feedOpen.update((v) => !v);
}
export function closeFeed(): void {
  feedOpen.set(false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/feed-store.ts web/test/feed-store.test.ts
git commit -m "feat(web): feedOpen store for collapsible mobile feed"
```

---

## Task 2: Controls flex container + mobile-compact theme switcher

**Files:**
- Create: `web/src/lib/controls/Controls.svelte`
- Modify: `web/src/App.svelte`, `web/src/lib/theme/ThemeSwitcher.svelte`, `web/src/lib/filter/PtrToggle.svelte`, `web/src/lib/auth/LogoutButton.svelte`

(No unit test — presentational; verified by build + the visual QA in Task 4.)

- [ ] **Step 1: Create `web/src/lib/controls/Controls.svelte`:**
```svelte
<script lang="ts">
  import LogoutButton from "../auth/LogoutButton.svelte";
  import PtrToggle from "../filter/PtrToggle.svelte";
  import ThemeSwitcher from "../theme/ThemeSwitcher.svelte";
</script>

<div class="controls">
  <LogoutButton />
  <PtrToggle />
  <ThemeSwitcher />
</div>

<style>
  .controls {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    max-width: calc(100vw - 24px);
  }
</style>
```

- [ ] **Step 2: Wire it into `App.svelte`.** Remove the three separate control imports and add the Controls import. Replace:
```ts
  import ThemeSwitcher from "./lib/theme/ThemeSwitcher.svelte";
```
with nothing (delete that line), and delete:
```ts
  import PtrToggle from "./lib/filter/PtrToggle.svelte";
```
and:
```ts
  import LogoutButton from "./lib/auth/LogoutButton.svelte";
```
Then add (next to the `LoginOverlay` import):
```ts
  import Controls from "./lib/controls/Controls.svelte";
```
(Keep `import { hidePtr } from "./lib/filter/ptr-store.js";` — that's the store, still used in the stream handler.)
In the markup, replace:
```svelte
<ThemeSwitcher />
<PtrToggle />
<LogoutButton />
```
with:
```svelte
<Controls />
```

- [ ] **Step 3: Strip positioning from the three controls.**

In `web/src/lib/theme/ThemeSwitcher.svelte`, rewrite the whole file to drop `position:fixed` and add the mobile-compact O/A/N labels:
```svelte
<script lang="ts">
  import { themeId } from "./theme-store.js";
  import type { ThemeId } from "./themes.js";

  const options: { id: ThemeId; label: string; short: string }[] = [
    { id: "obsidian", label: "Obsidian", short: "O" },
    { id: "aurora", label: "Aurora", short: "A" },
    { id: "nord", label: "Nord", short: "N" },
  ];
</script>

<div class="switcher">
  {#each options as o (o.id)}
    <button class:active={$themeId === o.id} onclick={() => themeId.set(o.id)} title={o.label}>
      <span class="full">{o.label}</span><span class="short">{o.short}</span>
    </button>
  {/each}
</div>

<style>
  .switcher {
    display: flex;
    gap: 4px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 4px;
    backdrop-filter: blur(8px);
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
  .short { display: none; }
  @media (max-width: 600px) {
    .full { display: none; }
    .short { display: inline; }
    button { padding: 3px 7px; }
  }
</style>
```

In `web/src/lib/filter/PtrToggle.svelte`, replace the `.ptr` style rule (remove `position/bottom/right/z-index`):
```css
  .ptr {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    backdrop-filter: blur(8px);
    font-family: -apple-system, sans-serif;
  }
```
(Leave the `<script>`, the `<button class="ptr" ...>` markup, and the `.ptr.hidden { color: var(--text); }` rule unchanged.)

In `web/src/lib/auth/LogoutButton.svelte`, replace the `.logout` style rule (remove `position/bottom/right/z-index`):
```css
  .logout {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    backdrop-filter: blur(8px);
    font-family: -apple-system, sans-serif;
  }
```
(Leave the `<script>`, the `{#if $role === "user" || $role === "guest"}` guard + markup, and the `.logout:hover` rule unchanged.)

- [ ] **Step 4: Type-check + build + tests**

Run: `cd web && npx tsc --noEmit && npm run build && npm test -w web`
Expected: clean build, all web tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/controls/Controls.svelte web/src/App.svelte web/src/lib/theme/ThemeSwitcher.svelte web/src/lib/filter/PtrToggle.svelte web/src/lib/auth/LogoutButton.svelte
git commit -m "refactor(web): controls into one flex container + mobile-compact theme switcher"
```

---

## Task 3: Mobile media queries + collapsible feed in Hud.svelte

**Files:**
- Modify: `web/src/lib/hud/Hud.svelte`

**READ the current `Hud.svelte` first.** Relevant: a `.panel.top-left` (with `.metrics` + optional `<ClientsList>`, `.top-left.expanded { width: 383px }`), a `.panel.top-right.gauge` (a 64×64 `<svg>` donut + `.gauge-text`), and a `{#if !isGuest}` `.panel.bottom-left.feed` (a `.feed-header` with the live `.dot` + version, then a `<ul>`). The base `.panel` is `position: fixed`.

- [ ] **Step 1: Import the feed store + add the pill, gate the feed.**

Add to the `<script>` imports (after the `donutSegments` import):
```ts
  import { feedOpen, toggleFeed } from "./feed-store.js";
```
Replace the feed block (the `{#if !isGuest} ... {/if}` around `.panel.bottom-left.feed`) with this — adds a pill button before the feed panel and an `open` class on the panel:
```svelte
{#if !isGuest}
<button class="feed-pill" onclick={toggleFeed} aria-label="Live-Feed ein-/ausblenden">
  <span class="dot" class:offline={!$hud.connected}></span>
  <span class="pill-label">Live</span>
</button>
<div class="panel bottom-left feed" class:open={$feedOpen}>
  <div class="feed-header">
    <span class="live">
      <span class="dot" class:offline={!$hud.connected}></span>
      <span class="label">Live</span>
    </span>
    <span class="version">v{version}</span>
  </div>
  <ul>
    {#each $hud.feed as item (item.id)}
      <li class:blocked={item.blocked}>
        <span class="origin-dot" data-origin={item.origin}></span>
        <span class="domain">{item.domain}</span>
        <span class="client">{item.clientName}</span>
      </li>
    {/each}
  </ul>
</div>
{/if}
```

- [ ] **Step 2: Add the pill base style + the mobile media query.** Add to the `<style>` block (after the existing `@keyframes blink` rule, before `</style>`):
```css
  /* Mobile-Pill: nur ≤600px sichtbar (Toggle für den eingeklappten Feed) */
  .feed-pill { display: none; }

  @media (max-width: 600px) {
    /* nichts läuft über den Rand */
    .top-left,
    .top-left.expanded,
    .bottom-left { width: auto; max-width: calc(100vw - 24px); }
    .panel { padding: 10px 12px; }

    /* Metriken kompakt */
    .metrics { gap: 12px; }
    .value { font-size: 16px; }

    /* Donut kompakt */
    .gauge { gap: 8px; }
    .gauge svg { width: 44px; height: 44px; }
    .gauge-text .value { font-size: 15px; }

    /* Feed eingeklappt → Pill; offen → Panel über der Pill */
    .feed { display: none; }
    .feed.open { display: flex; flex-direction: column; bottom: 60px; }
    .feed-pill {
      display: inline-flex; align-items: center; gap: 8px;
      position: fixed; bottom: 16px; left: 16px; z-index: 10;
      background: var(--panel); border: 1px solid var(--panel-border);
      border-radius: 10px; padding: 8px 12px; cursor: pointer;
      backdrop-filter: blur(8px); color: var(--text);
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
      font-family: -apple-system, sans-serif;
    }
  }
```

- [ ] **Step 3: Type-check + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean (an a11y hint is acceptable; no errors). The `.feed-pill` is rendered always but `display:none` until ≤600px.

- [ ] **Step 4: Visual QA at 390px and desktop.**

Start the local server if not running: `npm run dev:server` (serves `web/dist` on `:5641` in open mode). Then with the gstack browse binary (`B=~/.claude/skills/gstack/browse/dist/browse`):
```
$B viewport 390x844 && $B goto http://localhost:5641
$B js 'const r=s=>{const e=document.querySelector(s);return e?{l:Math.round(e.getBoundingClientRect().left),r:Math.round(e.getBoundingClientRect().right)}:null};JSON.stringify({metrics:r(".panel.top-left"),donut:r(".panel.top-right"),pill:r(".feed-pill"),feedHidden:getComputedStyle(document.querySelector(".feed")).display})'
```
Confirm at 390px: metrics `.r` < donut `.l` (NO overlap), donut `.r` ≤ 390 (no overflow), `feedHidden` is `"none"`, the `.feed-pill` is visible bottom-left. Tap it (`$B js 'document.querySelector(".feed-pill").click()'`) and confirm `.feed` `display` becomes `flex`. Screenshot (`$B screenshot /tmp/m.png`) and Read it.
**If metrics and donut still overlap at 390px**, tighten further (e.g. `.metrics { gap: 8px }` and/or `.value { font-size: 15px }`) and re-check — do not leave an overlap.
Then `$B viewport 1280x800 && $B goto http://localhost:5641` and confirm desktop is unchanged: feed panel visible (no pill), controls in a row bottom-right, metrics/donut full size.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hud/Hud.svelte
git commit -m "feat(web): responsive HUD ≤600px — compact metrics/donut, collapsible feed pill"
```

---

## Task 4: Verify + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full web suite + build**

Run: `npm test -w web` then `cd web && npm run build`
Expected: all web tests pass, build clean.

- [ ] **Step 2: Final visual QA (both viewports)**

Per Task 3 Step 4: at 390px — no overlap, no overflow, feed pill toggles the feed; at desktop — pixel-identical to before (feed panel + controls row, full-size metrics/donut). Read both screenshots.

- [ ] **Step 3: Update CHANGELOG**

Add a new `## [Unreleased]` section at the top of `CHANGELOG.md` (above the latest version):
```
## [Unreleased]

### Added
- Mobile-responsive HUD (≤600px): metrics + donut stay compact, the live feed
  collapses to a "● Live" pill (tap to open/close), the clients card and panels
  cap to the viewport, and the controls reflow into one row. Desktop unchanged.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for mobile-responsive HUD"
```

- [ ] **Step 4: Deploy to the Pi**

Per `deploy-pipeline` + `deploy-debugging-lessons` memory:
1. Merge to `main` first (finishing-a-development-branch).
2. **User** force-pushes the snapshot: `git push private "$(git commit-tree 'HEAD^{tree}' -m 'pigraph — Live Pi-hole DNS-Graph'):refs/heads/main" --force` (from local `main`; confirm `git log --oneline -1` shows the latest commit).
3. On the Pi: `cd ~/pihole-viz && git fetch origin && git reset --hard origin/main`, then **confirm the feature is in the snapshot** (`git ls-tree -r origin/main --name-only | grep feed-store.ts`) BEFORE rebuilding, then `docker-compose up -d --build --force-recreate`.
4. Verify at `:8089`: the served CSS contains a `@media` block with `max-width:600px` (`curl` the `/assets/*.css`); at a phone width the layout is responsive (a guest session can be used to check the served mobile layout without the password — note the feed/pill are hidden for guests, so verify the responsive metrics/donut + controls there, and the feed pill on a logged-in browser).

---

## Self-Review notes

- **Spec coverage:** breakpoint 600px (Task 3 media query); cap widths (Task 3); compact metrics + donut (Task 3); feed → "● Live" pill, ephemeral `feedOpen` (Task 1 store + Task 3 markup/CSS); clients card cap (Task 3 `.top-left.expanded` in media query); controls in one flex container replacing hardcoded offsets (Task 2); mobile-compact theme switcher (Task 2); desktop unchanged (all mobile rules behind the media query; Controls row matches today). ✓
- **Deviation from spec (noted):** the feed closes by tapping the same always-visible pill (the pill is the toggle, the feed opens above it), rather than tapping the feed-header — this avoids a non-interactive `<div>` click-handler (a11y) and is simpler. The spec intent (collapsible feed via a Live pill) is preserved.
- **Type/name consistency:** `feedOpen`/`toggleFeed`/`closeFeed` (Task 1) used in Hud.svelte (Task 3); `Controls.svelte` import paths (`../auth`, `../filter`, `../theme`) match the components' locations; ThemeSwitcher's new `short` field is local to that file. ✓
- **Non-breaking:** desktop layout unchanged (media query only); the controls refactor keeps each control's own pill style, only positioning moves to the container; `hidePtr` store import in App.svelte is preserved (separate from the PtrToggle component). ✓
- **Guest interaction:** the feed pill + feed are inside `{#if !isGuest}`, so guests get neither (consistent with guest mode hiding the feed). ✓
