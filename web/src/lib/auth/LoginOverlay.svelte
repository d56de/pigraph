<script lang="ts">
  import { login, loginAsGuest, guestEnabled } from "./auth-store.js";

  let password = $state("");
  let error = $state(false);
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = false;
    const ok = await login(password);
    busy = false;
    if (!ok) {
      error = true;
      password = "";
    }
  }
</script>

<div class="overlay">
  <form class="card" onsubmit={submit}>
    <h1>pigraph</h1>
    <p>Bitte anmelden</p>
    <input
      type="password"
      bind:value={password}
      placeholder="Passwort"
      class:err={error}
      autocomplete="current-password"
      autofocus
    />
    {#if error}<span class="msg">Falsches Passwort</span>{/if}
    <button type="submit" disabled={busy || password.length === 0}>
      {busy ? "…" : "Anmelden"}
    </button>
    {#if $guestEnabled}
      <button type="button" class="guest" onclick={() => loginAsGuest()}>Als Gast ansehen</button>
    {/if}
  </form>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg);
  }
  .card {
    display: flex; flex-direction: column; gap: 12px; width: 260px;
    background: var(--panel); border: 1px solid var(--panel-border);
    border-radius: 12px; padding: 24px;
  }
  h1 { font-size: 22px; color: var(--text); font-family: -apple-system, "SF Pro Text", sans-serif; }
  p { font-size: 12px; color: var(--text-dim); margin-top: -6px; }
  input {
    background: var(--bg); border: 1px solid var(--panel-border); border-radius: 8px;
    padding: 10px 12px; font-size: 14px; color: var(--text); outline: none;
  }
  input:focus { border-color: var(--text-dim); }
  input.err { border-color: var(--blocked); }
  .msg { font-size: 12px; color: var(--blocked); margin-top: -6px; }
  button {
    background: var(--panel-border); border: none; border-radius: 8px;
    padding: 10px; font-size: 14px; color: var(--text); cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .guest {
    background: none; border: 1px solid var(--panel-border); border-radius: 8px;
    padding: 9px; font-size: 13px; color: var(--text-dim); cursor: pointer;
  }
  .guest:hover { color: var(--text); }
</style>
