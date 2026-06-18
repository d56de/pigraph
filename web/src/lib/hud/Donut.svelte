<script lang="ts">
  import { hud } from "./hud-store.js";
  import { donutSegments } from "./donut.js";

  interface Props {
    size?: number;
  }
  let { size = 64 }: Props = $props();

  const CIRCUMFERENCE = 2 * Math.PI * 26;
  let segments = $derived(
    donutSegments(
      { cache: $hud.cached, unbound: $hud.forwarded, blocked: $hud.blocked, total: $hud.total },
      CIRCUMFERENCE,
    ),
  );
</script>

<svg viewBox="0 0 64 64" width={size} height={size}>
  <circle cx="32" cy="32" r="26" fill="none" stroke="var(--panel-border)" stroke-width="6" />
  {#each segments as seg}
    <circle
      cx="32" cy="32" r="26" fill="none"
      stroke={seg.color} stroke-width="6" stroke-linecap="butt"
      stroke-dasharray="{seg.dash} {CIRCUMFERENCE}"
      transform="rotate({seg.rotate - 90} 32 32)"
    />
  {/each}
</svg>
