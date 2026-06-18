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
