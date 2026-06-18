<script lang="ts">
  import { hidePtr } from "./ptr-store.js";
</script>

<button
  class="ptr"
  class:hidden={$hidePtr}
  title="Reverse-DNS / mDNS (PTR) aus- bzw. einblenden"
  onclick={() => hidePtr.update((v) => !v)}
>
  PTR {$hidePtr ? "aus" : "an"}
</button>

<style>
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
  .ptr.hidden { color: var(--text); }
</style>
