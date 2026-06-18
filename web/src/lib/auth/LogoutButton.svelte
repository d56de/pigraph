<script lang="ts">
  import { role, logout } from "./auth-store.js";

  async function doLogout() {
    await logout();
    location.reload(); // sauberer Reset: Stream trennen, Overlay zeigen
  }
</script>

{#if $role === "user" || $role === "guest"}
  <button class="logout" title="Abmelden" onclick={doLogout}>Abmelden</button>
{/if}

<style>
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
  .logout:hover { color: var(--text); }
</style>
