<script lang="ts">
  import { hud } from "./hud-store.js";
  import type { GraphState } from "../graph/store.js";
  import ClientsList from "../clients/ClientsList.svelte";
  import { clientsPanelOpen, toggleClientsPanel, closeClientsPanel } from "../clients/clients-panel-store.js";
  import { feedOpen, toggleFeed } from "./feed-store.js";
  import Donut from "./Donut.svelte";

  interface Props {
    getState: () => GraphState;
    onSelectClient: (id: string) => void;
    activeCount: number;
    isGuest?: boolean;
  }
  let { getState, onSelectClient, activeCount, isGuest = false }: Props = $props();

  const version = __APP_VERSION__;

  let panelEl = $state<HTMLDivElement | null>(null);

  function onWindowClick(e: MouseEvent) {
    if (!$clientsPanelOpen) return;
    if (panelEl && !panelEl.contains(e.target as Node)) closeClientsPanel();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && closeClientsPanel()} onclick={onWindowClick} />

<div class="panel top-left" class:expanded={$clientsPanelOpen} bind:this={panelEl}>
  <div class="metrics">
    <div class="metric">
      <span class="label">Queries heute</span>
      <span class="value">{$hud.total.toLocaleString("de-DE")}</span>
    </div>
    <div class="metric">
      <span class="label">Geblockt</span>
      <span class="value blocked">{$hud.blocked.toLocaleString("de-DE")}</span>
    </div>
    {#if !isGuest}
      <button class="metric clients-btn" onclick={(e) => { e.stopPropagation(); toggleClientsPanel(); }}>
        <span class="label">Clients</span>
        <span class="value clients-value"><span class="counts"><span class="active-n">{activeCount}</span> / {$hud.clients}</span><span class="caret" class:open={$clientsPanelOpen}>▾</span></span>
      </button>
    {/if}
    <div class="gauge-mobile">
      <Donut size={28} />
      <span class="rate">{$hud.percent.toFixed(0)}%</span>
    </div>
  </div>
  {#if $clientsPanelOpen && !isGuest}
    <ClientsList {getState} onSelect={onSelectClient} />
  {/if}
</div>

<div class="panel top-right gauge">
  <Donut size={64} />
  <div class="gauge-text">
    <span class="value">{$hud.percent.toFixed(1)}%</span>
    <span class="label">Block-Rate</span>
  </div>
</div>

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
  .top-left { top: 16px; left: 16px; display: flex; flex-direction: column; align-items: stretch; }
  .top-left.expanded { width: 383px; } /* stabile Breite mit Clients-Liste = Breite der Live-Card */
  .metrics { display: flex; gap: 24px; }
  .clients-btn {
    background: none; border: none; padding: 0; margin: 0; cursor: pointer;
    text-align: left; font: inherit; color: inherit; pointer-events: auto;
  }
  .clients-value { display: inline-flex; align-items: center; gap: 6px; }
  .counts { font-variant-numeric: tabular-nums; }
  .active-n { color: var(--allowed); font-weight: 600; } /* grün = aktiv/live, analog zum Dot im Panel */
  .caret { font-size: 11px; color: var(--text-dim); line-height: 1; display: inline-block; transition: transform 0.15s; }
  .caret.open { transform: rotate(180deg); }
  .top-right { top: 16px; right: 16px; }
  .bottom-left { bottom: 16px; left: 16px; width: 383px; } /* Breite = aufgeklappte Queries-Card (mit Clients-Liste) */

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
  .gauge-mobile { display: none; } /* nur Mobile: Donut in der Metrik-Leiste */

  .feed ul {
    list-style: none; margin-top: 6px; display: flex; flex-direction: column; gap: 3px;
    /* scrollbar, um auch ältere Einträge nochmal anzusehen — neueste oben */
    max-height: 240px; overflow-y: auto;
    /* eigenes Scroll-Target: sonst frisst der Canvas (pointer-events:none am Panel) das Wheel → Graph zoomt */
    pointer-events: auto;
    scrollbar-width: thin; scrollbar-color: var(--panel-border) transparent;
  }
  .feed ul::-webkit-scrollbar { width: 8px; }
  .feed ul::-webkit-scrollbar-track { background: transparent; }
  .feed ul::-webkit-scrollbar-thumb {
    background: var(--panel-border); border-radius: 4px;
    border: 2px solid transparent; background-clip: padding-box;
  }
  .feed ul::-webkit-scrollbar-thumb:hover { background: var(--text-dim); background-clip: padding-box; }
  .feed li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    line-height: 1.5;
    font-family: ui-monospace, "SF Mono", monospace;
    color: var(--allowed);
  }
  .feed li.blocked { color: var(--blocked); text-decoration: line-through; }
  .feed .domain { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .feed .client { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); text-decoration: none; }
  .origin-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim); }
  .origin-dot[data-origin="cache"] { background: var(--allowed); }
  .origin-dot[data-origin="unbound"] { background: var(--forwarded); }
  .origin-dot[data-origin="blocked"] { background: var(--blocked); }

  .feed-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .live { display: flex; align-items: center; gap: 8px; }
  .version {
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    font-family: ui-monospace, "SF Mono", monospace;
    font-variant-numeric: tabular-nums;
  }

  .dot { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--allowed); }
  /* „Ping"-Halo: erbt die Dot-Farbe (Theme-treu) und pulsiert nach außen. */
  .dot::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: inherit;
    animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  .dot.offline { background: var(--blocked); animation: blink 1s infinite; }
  .dot.offline::after { display: none; } /* offline kein Puls, nur Blinken */

  @keyframes ping {
    0% { transform: scale(1); opacity: 0.7; }
    75%, 100% { transform: scale(2.6); opacity: 0; }
  }
  @keyframes blink { 50% { opacity: 0.3; } }

  /* Mobile-Pill: nur ≤600px sichtbar (Toggle für den eingeklappten Feed) */
  .feed-pill { display: none; }

  @media (max-width: 600px) {
    /* nichts läuft über den Rand */
    .top-left,
    .top-left.expanded,
    .bottom-left { width: auto; max-width: calc(100vw - 24px); }
    .panel { padding: 10px 12px; }

    /* Metriken kompakt; Donut wandert in die Leiste (eine einheitliche Box) */
    .metrics { gap: 12px; align-items: center; }
    .value { font-size: 14px; }
    .label { font-size: 9px; letter-spacing: 0.04em; }
    .top-right { display: none; }
    .gauge-mobile { display: inline-flex; align-items: center; gap: 6px; }
    .gauge-mobile .rate { font-size: 14px; font-variant-numeric: tabular-nums; color: var(--text); }

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
</style>
