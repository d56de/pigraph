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

  // Blockier-Zähler je Client merken; steigt er, kurz rot aufpulsen (wie im Graphen).
  const prevBlocked = new Map<string, number>();
  const pulse = new Map<string, number>(); // Token je Client, +1 bei jedem neuen Block

  const refresh = () => {
    const rows = activeClients(getState(), Date.now());
    for (const r of rows) {
      const prev = prevBlocked.get(r.id);
      if (prev !== undefined && r.blocked > prev) {
        pulse.set(r.id, (pulse.get(r.id) ?? 0) + 1);
      }
      prevBlocked.set(r.id, r.blocked);
    }
    active = rows;
  };
  refresh();
  const timer = setInterval(refresh, 1000);
  onDestroy(() => clearInterval(timer));

  // Clients, die gerade einen Live-Knoten haben (für den "aktiv jetzt"-Dot im 24h-Tab).
  let activeIps = $derived(new Set(active.map((c) => c.ip)));
  const fmt = (n: number) => n.toLocaleString("de-DE");
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
            <span class="dot"></span>
            <span class="who">
              <span class="name">{c.name}</span>
              {#if c.name !== c.ip}<span class="ip">{c.ip}</span>{/if}
            </span>
            <span class="metrics">
              <span class="fwd" title="an Unbound forwarded (recursed)">↑{fmt(c.forwarded)}</span>
              {#key pulse.get(c.id) ?? 0}
                <span class="blk" class:flash={(pulse.get(c.id) ?? 0) > 0}>{fmt(c.blocked)}</span>
              {/key}
              <span class="pct">{pct(c.total, c.blocked)}%</span>
            </span>
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
            <span class="who">
              <span class="name">{c.name}</span>
              {#if c.name !== c.ip}<span class="ip">{c.ip}</span>{/if}
            </span>
            <span class="metrics">
              <span class="fwd none" title="kein Cache/Unbound-Split in der 24h-Statistik">↑ –</span>
              <span class="blk">{fmt(c.blocked)}</span>
              <span class="pct">{pct(c.total, c.blocked)}%</span>
            </span>
          </button>
        </li>
      {:else}
        <li class="empty">lädt…</li>
      {/each}
    {/if}
  </ul>
</div>

<style>
  .clients { margin-top: 10px; border-top: 1px solid var(--panel-border); padding-top: 8px; pointer-events: auto; }
  .tabs { display: flex; gap: 4px; margin-bottom: 6px; }
  .tabs button {
    background: none; border: none; cursor: pointer;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-dim); padding: 3px 8px; border-radius: 5px;
    font-family: -apple-system, "SF Pro Text", sans-serif;
  }
  .tabs button.on { background: var(--panel-border); color: var(--text); }

  ul {
    list-style: none; max-height: 320px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
    /* schlanke Scrollbar ohne Track-Hintergrund, leicht eingerückt */
    scrollbar-width: thin;
    scrollbar-color: var(--panel-border) transparent;
  }
  ul::-webkit-scrollbar { width: 8px; }
  ul::-webkit-scrollbar-track { background: transparent; }
  ul::-webkit-scrollbar-thumb {
    background: var(--panel-border);
    border-radius: 4px;
    border: 2px solid transparent; /* setzt den sichtbaren Daumen ein → schmaler, mit Abstand */
    background-clip: padding-box;
  }
  ul::-webkit-scrollbar-thumb:hover { background: var(--text-dim); background-clip: padding-box; }

  /* Identität links (Dot + Name + ggf. IP), Metriken rechts — Rhythmus über die 12px-Lücke. */
  .row {
    width: 100%; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: center; gap: 12px;
    background: none; border: none; cursor: pointer; text-align: left;
    padding: 5px 6px; border-radius: 6px;
    font-size: 12px; font-family: ui-monospace, "SF Mono", monospace; color: var(--text);
  }
  .row:hover { background: var(--panel-border); }

  /* grün = aktiv/live (im Aktiv-Tab immer, im 24h-Tab nur bei Live-Knoten) */
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--allowed); }
  .dot.idle { background: var(--text-dim); opacity: 0.5; }

  .who { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ip { flex: none; color: var(--text-dim); font-size: 10px; }

  /* Metriken: Block-Anzahl (pulst rot beim neuen Block) + Block-Rate %, tabellarisch ausgerichtet. */
  .metrics { display: flex; align-items: baseline; gap: 10px; }
  .fwd { color: var(--forwarded); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
  .fwd.none { color: var(--text-dim); }
  .blk { color: var(--text-dim); font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }
  .blk.flash { animation: blockpulse 0.9s ease-out; }
  .pct { color: var(--text); font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
  @keyframes blockpulse {
    0%, 45% { color: var(--blocked); }
    100% { color: var(--text-dim); }
  }
  .empty { color: var(--text-dim); font-size: 12px; padding: 6px; }
</style>
