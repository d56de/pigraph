# Mobile-Responsive HUD — Design

Date: 2026-06-18
Status: Approved (brainstorming)

## Overview

On narrow screens the HUD breaks: every panel is `position: fixed` with a fixed
width, so on a ~390px phone the top-right donut overlaps the top-left metrics
(hiding the Clients metric), the 383px Live feed overflows the right edge, and
the bottom-right controls sit on top of the feed. Make the HUD responsive below a
breakpoint: **essentials stay (compact), the heavy panels collapse to tap-to-open**,
and the graph keeps the screen. Desktop is unchanged.

Chosen strategy (from brainstorming): *essentials small, the rest collapsible.*

## Goals

- Below **600px**: nothing overflows the viewport; no panel overlaps another.
- **Metrics + donut** stay visible, compact, side by side at the top.
- **Live feed** collapses to a "● Live" pill (keeps the connection indicator); tap
  opens the feed as an overlay, tap closes.
- **Clients list** keeps its existing toggle; when open it caps to the viewport width.
- **Controls** (logout / PTR / theme) reflow into one flex container instead of three
  hardcoded `right:` offsets, and condense on mobile so they don't collide with the
  feed pill.
- **Desktop (≥601px) is pixel-identical to today.**

## Non-Goals (YAGNI)

- Draggable / user-repositionable panels (a separate idea, deferred).
- A landscape-specific layout, or tablet-specific breakpoints (one breakpoint).
- Persisting the feed open/closed state — it defaults closed on each load (ephemeral).
- Animated transitions for the collapse (a plain show/hide is enough for v1).

## Breakpoint

`@media (max-width: 600px)` drives all mobile rules. (The metrics box is ~298px and
the donut ~181px, so they start overlapping below ~520px; 600px triggers the mobile
treatment with margin to spare.) Above 600px: no mobile rules apply → current layout.

## Architecture & components

| Unit | Change |
|------|--------|
| `web/src/lib/hud/feed-store.ts` (new) | `feedOpen` writable (default `false`), `toggleFeed()`, `closeFeed()` — mirrors `clients-panel-store.ts`. Ephemeral (not persisted). |
| `web/src/lib/hud/Hud.svelte` | Mobile media queries: cap panel widths; compact metrics + donut; hide the feed panel and show a "● Live" pill that toggles `feedOpen`; cap the expanded clients card to the viewport. Desktop rules unchanged. |
| `web/src/lib/controls/Controls.svelte` (new) | A flex container (`position: fixed; bottom; right; display:flex; gap; flex-wrap; justify-content:flex-end; max-width: calc(100vw - 24px)`) wrapping `<LogoutButton/> <PtrToggle/> <ThemeSwitcher/>`. |
| `web/src/App.svelte` | Replace the three separate `<ThemeSwitcher/> <PtrToggle/> <LogoutButton/>` with `<Controls/>`. |
| `web/src/lib/theme/ThemeSwitcher.svelte` | Remove its own `position: fixed` (becomes a flex child). Add a mobile-compact form (buttons shrink to single-letter/dot, ~50px instead of 166px). |
| `web/src/lib/filter/PtrToggle.svelte` | Remove its own `position: fixed` (becomes a flex child); keep style. |
| `web/src/lib/auth/LogoutButton.svelte` | Remove its own `position: fixed` (becomes a flex child); keep style + the `{#if role}` guard. |

### Mobile behaviors (≤600px)

1. **Width caps.** `.panel.top-left`, `.panel.top-left.expanded`, `.panel.bottom-left.feed`
   get `max-width: calc(100vw - 24px)` (and the fixed 383px/298px widths relax to fit).
2. **Metrics (top-left):** value font 20→16px, `.metrics` gap 24→12px, panel padding tighter.
   Stays in the top-left corner, now narrow enough to clear the donut.
3. **Donut (top-right):** SVG 64→44px (viewBox scales the ring + dash math automatically),
   gauge value/label fonts smaller. Stays in the top-right corner.
4. **Feed (bottom-left):** mutually-exclusive pill ⇄ panel, both at bottom-left:
   - When `!feedOpen` (default): the `.feed` panel is `display:none`; a compact
     **"● Live" pill** (the connection dot + the word "Live", reusing the existing dot/
     `offline` styling) is shown. Tapping it → `feedOpen=true` (opens the feed).
   - When `feedOpen`: the feed panel is shown (capped width, scrollable, overlaying the
     graph) and the pill is hidden. The existing **feed-header** ("LIVE" + version) becomes
     the close affordance — tapping it → `feedOpen=false` (collapses back to the pill).
   Both the pill and the feed are inside the existing `{#if !isGuest}` (guests have no
   feed). On desktop: the pill is `display:none`, the feed is always shown, and the
   feed-header is not a toggle (no behavior change).
5. **Clients list:** unchanged `clientsPanelOpen` toggle; `.top-left.expanded` width caps to
   `calc(100vw - 24px)` so the open card fits; names already ellipsis.
6. **Controls:** the new `Controls.svelte` flex container wraps if needed. On mobile the
   theme switcher condenses (~50px) so the controls cluster (logout + PTR + compact theme)
   stays clear of the feed pill down to ~360px.

### Desktop (≥601px)

`Controls.svelte` lays the three controls in a right-aligned row at `bottom:16px;
right:16px` — visually identical to today's three hardcoded positions (order
left→right: Logout, PTR, Theme). The feed panel is always visible; the Live pill is
hidden. Metrics/donut/feed keep their current sizes (383px cards, etc.).

## Data flow

```
feedOpen store ──┐
                 ├─ Hud.svelte: mobile → pill (tap toggles feedOpen) ⇄ feed panel (shown when feedOpen)
matchMedia(600) ─┘   desktop → feed always shown, pill hidden  (all via CSS @media, no JS branch)
Controls.svelte ── fixed flex container → Logout / PTR / Theme (theme compact on mobile)
```

No JS viewport detection is needed: the show/hide of pill-vs-feed and the compacting
are pure CSS media queries; only the feed open/close needs the `feedOpen` store + the
pill's click handler.

## Edge cases
- **Guest on mobile:** no feed and no pill (both inside `{#if !isGuest}`); metrics show
  Queries/Geblockt only (Clients control already hidden for guests), donut shows. Controls
  show logout (guest) + PTR + theme.
- **Feed open, then rotate to desktop width:** the desktop `@media` shows the feed panel
  regardless of `feedOpen`; the pill hides. Consistent (feed visible either way).
- **Very narrow (≤360px):** controls flex-wrap to a second row (bottom-anchored); width
  caps keep panels on-screen. Verified visually.
- **Open clients list + open feed on mobile:** both are overlays in opposite corners
  (top-left card, bottom feed); they don't conflict.

## Testing
- `feed-store.ts`: `toggleFeed` flips `feedOpen`; `closeFeed` sets false (unit test, mirrors
  any existing panel-store test).
- Visual QA (browser at 390px and at desktop width, via the local `:5641` server):
  - 390px: metrics + donut do NOT overlap; nothing overflows the right edge; feed shows as a
    "● Live" pill; tapping it opens the feed (capped, scrollable); controls clear of the pill.
  - desktop: layout pixel-identical to current (feed panel visible, controls row, no pill).
- Existing web tests stay green (the controls refactor must not change behavior).

## Rollout
Frontend-only; no server/shared change. Ships via the existing snapshot deploy.
Verify the deployed mobile layout at the served endpoint (browser at phone width).
