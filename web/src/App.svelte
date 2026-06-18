<script lang="ts">
  import { onMount } from "svelte";
  import { SummaryEventSchema } from "@pihole-viz/shared";
  import Hud from "./lib/hud/Hud.svelte";
  import { connectStream } from "./lib/stream.js";
  import { applyQuery, emptyGraph, tick } from "./lib/graph/store.js";
  import type { GraphState } from "./lib/graph/store.js";
  import { GraphRenderer } from "./lib/render/renderer.js";
  import { clusterView } from "./lib/graph/cluster.js";
  import { attachPanZoom } from "./lib/render/panzoom.js";
  import { applyServerEvent } from "./lib/hud/hud-store.js";
  import DetailCard from "./lib/detail/DetailCard.svelte";
  import { selectNode, clearSelection } from "./lib/detail/selection-store.js";
  import { themeId } from "./lib/theme/theme-store.js";
  import { THEMES, type ThemeId } from "./lib/theme/themes.js";
  import { get } from "svelte/store";
  import { hidePtr } from "./lib/filter/ptr-store.js";
  import { setClients } from "./lib/clients/clients-store.js";
  import { authed, role, checkAuth } from "./lib/auth/auth-store.js";
  import LoginOverlay from "./lib/auth/LoginOverlay.svelte";
  import Controls from "./lib/controls/Controls.svelte";

  let container: HTMLDivElement;
  let tooltip = $state<{ text: string; x: number; y: number } | null>(null);
  let hiddenDomains = $state(0);
  let highlighted: string | null = null;

  // Auswahl aus dem Client-Panel: nur hervorheben, wenn der Client gerade einen Live-Knoten hat.
  function selectClientFromPanel(id: string): void {
    if (!currentView.nodes.has(id)) return; // 24h-Client ohne Live-Knoten → nur Panel-Stats
    highlighted = id;
    renderer?.setHighlight(id);
    selectNode(id);
  }
  let renderer = $state<GraphRenderer | null>(null);
  let getGraph = $state<() => GraphState>(() => emptyGraph());
  let currentView = $state<GraphState>(emptyGraph());
  // Live aktive Clients (Knoten im Graph) — für die "5/33"-Anzeige im HUD.
  let activeClientCount = $derived(
    [...currentView.nodes.values()].filter((n) => n.kind === "client").length,
  );

  onMount(() => {
    let graph = emptyGraph();
    getGraph = () => currentView;
    const expandedGroups = new Set<string>();
    const render = () => {
      currentView = clusterView(graph, expandedGroups);
      renderer?.update(currentView);
    };
    let disconnect: (() => void) | undefined;
    let detachPanZoom: (() => void) | undefined;
    let rendererReady = false;
    let dataStarted = false;
    void checkAuth();

    // Datenstrom + initiale Summary erst starten, wenn der Renderer bereit UND eingeloggt ist
    // (im Open-Mode liefert /api/me authenticated:true → läuft sofort). Idempotent über dataStarted.
    const startData = () => {
      if (dataStarted || !rendererReady || get(authed) !== true) return;
      dataStarted = true;
      disconnect = connectStream("/events", {
        onEvent(event) {
          if (event.type === "query" && event.recordType === "PTR" && get(hidePtr)) {
            return; // PTR/Reverse-DNS ausgeblendet
          }
          applyServerEvent(event);
          if (event.type === "query") {
            graph = applyQuery(graph, event, Date.now());
            render();
          } else if (event.type === "clients") {
            setClients(event.clients);
          }
        },
        onConnectionChange(connected) {
          applyServerEvent({ type: "status", state: connected ? "online" : "offline" });
        },
      });
      // Initiale Summary, damit das HUD nicht bei 0 startet
      void fetch("/api/summary")
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          const parsed = SummaryEventSchema.safeParse(raw);
          if (parsed.success) applyServerEvent(parsed.data);
        })
        .catch(() => undefined);
    };
    const unsubAuthed = authed.subscribe(() => startData());

    renderer = new GraphRenderer({
      onHover(nodeId, x, y) {
        tooltip = nodeId ? { text: nodeId.replace(/^(client|domain|group):/, ""), x, y } : null;
      },
      onTap(nodeId) {
        if (nodeId.startsWith("group:")) {
          const reg = nodeId.slice("group:".length);
          if (expandedGroups.has(reg)) expandedGroups.delete(reg);
          else expandedGroups.add(reg);
          render();
          selectNode(nodeId);
          return;
        }
        highlighted = highlighted === nodeId ? null : nodeId;
        renderer?.setHighlight(highlighted);
        if (highlighted) selectNode(nodeId);
        else clearSelection();
      },
      onBackgroundTap() {
        highlighted = null;
        renderer?.setHighlight(null);
        clearSelection();
      },
    });

    const applyTheme = (id: ThemeId) => {
      const css = THEMES[id].css;
      const root = document.documentElement.style;
      root.setProperty("--bg", css.bg);
      root.setProperty("--panel", css.panel);
      root.setProperty("--panel-border", css.panelBorder);
      root.setProperty("--text", css.text);
      root.setProperty("--text-dim", css.textDim);
      root.setProperty("--client", css.client);
      root.setProperty("--allowed", css.allowed);
      root.setProperty("--blocked", css.blocked);
      root.setProperty("--forwarded", css.forwarded);
      renderer?.setTheme(THEMES[id].graph);
    };
    let lastTheme: ThemeId = "obsidian";
    const unsubTheme = themeId.subscribe((id) => {
      lastTheme = id;
      applyTheme(id);
    });

    void renderer.init(container).then(() => {
      detachPanZoom = attachPanZoom(renderer!.canvas, renderer!.worldContainer, {
        isSuspended: () => renderer!.draggingNode,
        onPinch: () => renderer!.cancelDrag(),
      });
      applyTheme(lastTheme);
      rendererReady = true;
      startData();
    });

    const decayTimer = setInterval(() => {
      graph = tick(graph, Date.now());
      hiddenDomains = graph.droppedDomains;
      render();
    }, 1000);

    return () => {
      clearInterval(decayTimer);
      unsubTheme();
      unsubAuthed();
      disconnect?.();
      detachPanZoom?.();
      renderer?.destroy();
    };
  });
</script>

<div class="stage" bind:this={container}></div>
{#if tooltip}
  <div class="tooltip" style="left: {tooltip.x + 14}px; top: {tooltip.y + 14}px">
    {tooltip.text}
  </div>
{/if}
{#if hiddenDomains > 0}
  <div class="cap-notice">Limit 400 Domains erreicht – {hiddenDomains} ältere verworfen</div>
{/if}
<Hud getState={getGraph} onSelectClient={selectClientFromPanel} activeCount={activeClientCount} isGuest={$role === "guest"} />
{#if renderer}
  <DetailCard {renderer} getGraph={getGraph} />
{/if}
<Controls />
{#if $authed === false}
  <LoginOverlay />
{/if}

<style>
  .stage { width: 100%; height: 100%; }
  .cap-notice {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--text-dim);
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 3px 10px;
    z-index: 10;
  }
  .tooltip {
    position: fixed;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
    pointer-events: none;
    z-index: 20;
  }
</style>
