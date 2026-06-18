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
  <div class="card" class:flip style="left: {pos.x}px; top: {pos.y}px">
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
