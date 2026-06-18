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
