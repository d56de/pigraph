import {
  Application,
  Circle,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Text,
} from "pixi.js";
import type { GraphState } from "../graph/store.js";
import { GraphSimulation } from "./simulation.js";
import { clientRadius, domainRadius } from "./sizes.js";
import { THEMES, type GraphPalette } from "../theme/themes.js";

interface NodeVisual {
  root: Container;
  /** Knotenkreis als echtes Vektor-Graphics → bei jedem Zoom scharf. */
  core: Graphics;
  label: Text;
  badge: Text;
  pulse: number;
  lastHits: number;
  /** Welche Größe/Farbe der Kern zuletzt gezeichnet wurde (spart Neuzeichnen). */
  coreRadius: number;
  coreColor: number;
}

// Ein echter Drag (Versatz über diese Distanz in Bildschirmpixeln) lässt den
// Knoten an der Ablegeposition fixiert; ein reiner Klick darunter nicht.
const DRAG_THRESHOLD_PX = 4;

export interface RendererCallbacks {
  onHover?: (nodeId: string | null, x: number, y: number) => void;
  onTap?: (nodeId: string) => void;
  onBackgroundTap?: () => void;
}

export class GraphRenderer {
  private app!: Application;
  private world!: Container;
  private edgeGfx!: Graphics;
  private nodeLayer!: Container;
  private sim!: GraphSimulation;
  private readonly visuals = new Map<string, NodeVisual>();
  private state: GraphState | null = null;
  private highlightId: string | null = null;
  private draggingId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private palette: GraphPalette = THEMES.obsidian.graph;

  constructor(private readonly callbacks: RendererCallbacks = {}) {}

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: this.palette.background,
      resizeTo: container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(this.app.canvas);

    // Touch-Gesten dem Canvas überlassen: sonst kapert der Browser Ein-Finger-Pan
    // und Pinch und bricht dabei die Pointer-Events ab (pointercancel) → auf
    // Touch-Displays liesse sich der Graph weder verschieben noch zoomen.
    this.app.canvas.style.touchAction = "none";

    this.world = new Container();
    this.edgeGfx = new Graphics();
    this.nodeLayer = new Container();
    this.world.addChild(this.edgeGfx, this.nodeLayer);
    this.app.stage.addChild(this.world);

    this.sim = new GraphSimulation(this.app.screen.width, this.app.screen.height);

    this.app.renderer.on("resize", (w: number, h: number) => this.sim.resize(w, h));

    // Drag wird auf Stage-Ebene fortgeführt/beendet, damit er auch dann greift,
    // wenn der Cursor den Knoten verlässt (schnelles Ziehen).
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("globalpointermove", (e) => this.onDragMove(e));
    this.app.stage.on("pointerup", () => this.endDrag());
    this.app.stage.on("pointerupoutside", () => this.endDrag());
    this.app.stage.on("pointertap", (e) => {
      if (e.target === this.app.stage) this.callbacks.onBackgroundTap?.();
    });

    this.app.ticker.add(() => this.frame());
  }

  /** True, solange ein Knoten gezogen wird — Pan/Zoom pausiert dann. */
  get draggingNode(): boolean {
    return this.draggingId !== null;
  }

  private startDrag(id: string, e: FederatedPointerEvent): void {
    this.draggingId = id;
    this.dragStartX = e.global.x;
    this.dragStartY = e.global.y;
    this.dragMoved = false;
    const p = this.world.toLocal(e.global);
    this.sim.pin(id, p.x, p.y);
  }

  private onDragMove(e: FederatedPointerEvent): void {
    if (!this.draggingId) return;
    if (!this.dragMoved) {
      const dx = e.global.x - this.dragStartX;
      const dy = e.global.y - this.dragStartY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) this.dragMoved = true;
    }
    const p = this.world.toLocal(e.global);
    this.sim.pin(this.draggingId, p.x, p.y);
  }

  /** Bricht einen laufenden Knoten-Drag ab und gibt den Knoten zurück an die
   *  Simulation – genutzt, wenn ein zweiter Finger einen Pinch-Zoom startet. */
  cancelDrag(): void {
    if (this.draggingId === null) return;
    this.sim.unpin(this.draggingId);
    this.draggingId = null;
    this.dragMoved = false;
  }

  private endDrag(): void {
    if (!this.draggingId) return;
    // Echter Drag → an der Ablegeposition fixiert lassen (bis Reload).
    // Reiner Klick → Knoten wieder freigeben (sonst friert Klick-zum-Highlight ein).
    if (this.dragMoved) this.sim.release();
    else this.sim.unpin(this.draggingId);
    this.draggingId = null;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get worldContainer(): Container {
    return this.world;
  }

  /** Aktuelle Bildschirmposition (Canvas-Pixel) eines Knotens, oder null. */
  screenPosition(id: string): { x: number; y: number } | null {
    if (!this.app) return null;
    const p = this.sim?.position(id);
    if (!p) return null;
    const g = this.world.toGlobal({ x: p.x, y: p.y });
    return { x: g.x, y: g.y };
  }

  update(state: GraphState): void {
    if (!this.sim) return; // init() not yet complete
    this.state = state;
    this.sim.sync(state);
    this.syncVisuals(state);
  }

  setHighlight(id: string | null): void {
    this.highlightId = id;
  }

  setTheme(palette: GraphPalette): void {
    this.palette = palette;
    if (this.app) this.app.renderer.background.color = palette.background;
    for (const visual of this.visuals.values()) {
      visual.coreColor = -1; // erzwingt Neuzeichnen des Kerns im nächsten Frame
      visual.label.style.fill = visual.label.style.fontSize === 13 ? palette.labelClient : palette.labelDomain;
      visual.badge.style.fill = palette.background;
    }
  }

  private coreColor(blocked: boolean, kind: "client" | "domain"): number {
    if (kind === "client") return this.palette.client;
    return blocked ? this.palette.domainBlocked : this.palette.domainAllowed;
  }

  private syncVisuals(state: GraphState): void {
    for (const [id, visual] of this.visuals) {
      if (!state.nodes.has(id)) {
        visual.root.destroy({ children: true });
        this.visuals.delete(id);
      }
    }

    for (const node of state.nodes.values()) {
      let visual = this.visuals.get(node.id);
      if (!visual) {
        const root = new Container();
        const core = new Graphics();
        const label = new Text({
          text: node.label,
          style: {
            fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
            fontSize: node.kind === "client" ? 13 : 10,
            fill: node.kind === "client" ? this.palette.labelClient : this.palette.labelDomain,
          },
        });
        // Anker unten-mittig: das Label wird im Frame über den Knoten gesetzt.
        label.anchor.set(0.5, 1);
        const badge = new Text({
          text: "",
          style: { fontFamily: "-apple-system, sans-serif", fontSize: 9, fontWeight: "700", fill: this.palette.background },
        });
        badge.anchor.set(0.5, 0.5);
        root.addChild(core, label, badge);
        root.eventMode = "static";
        root.cursor = "pointer";
        root.on("pointerover", (e) =>
          this.callbacks.onHover?.(node.id, e.global.x, e.global.y),
        );
        root.on("pointerout", () => this.callbacks.onHover?.(null, 0, 0));
        root.on("pointertap", () => this.callbacks.onTap?.(node.id));
        root.on("pointerdown", (e) => this.startDrag(node.id, e));
        this.nodeLayer.addChild(root);
        visual = { root, core, label, badge, pulse: 0, lastHits: 0, coreRadius: -1, coreColor: -1 };
        this.visuals.set(node.id, visual);
      }

      if (node.hits > visual.lastHits) {
        visual.pulse = 1; // neue Query → aufleuchten
        visual.lastHits = node.hits;
      }

      visual.label.text = node.label;
    }
  }

  private neighborhood(id: string): Set<string> {
    const keep = new Set([id]);
    if (!this.state) return keep;
    for (const edge of this.state.edges.values()) {
      if (edge.source === id) keep.add(edge.target);
      if (edge.target === id) keep.add(edge.source);
    }
    return keep;
  }

  /** Kern nur neu tessellieren, wenn sich Radius oder Farbe geändert haben. */
  private drawCore(visual: NodeVisual, radius: number, color: number): void {
    if (visual.coreRadius === radius && visual.coreColor === color) return;
    visual.coreRadius = radius;
    visual.coreColor = color;
    visual.core.clear().circle(0, 0, radius).fill({ color });
  }

  private frame(): void {
    if (!this.state) return;
    this.sim.step();

    const highlight = this.highlightId ? this.neighborhood(this.highlightId) : null;

    this.edgeGfx.clear();
    for (const edge of this.state.edges.values()) {
      const a = this.sim.position(edge.source);
      const b = this.sim.position(edge.target);
      if (!a || !b) continue;
      const target = this.state.nodes.get(edge.target);
      const targetVisual = this.visuals.get(edge.target);
      const pulse = targetVisual?.pulse ?? 0;
      const dimmed = highlight !== null && !(highlight.has(edge.source) && highlight.has(edge.target));
      const baseAlpha = Math.min(0.5, 0.15 + (target?.opacity ?? 0) * 0.35) * (dimmed ? 0.15 : 1);
      this.edgeGfx.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
        width: 1 + Math.min(edge.hits, 8) * 0.15 + pulse,
        color: edge.blocked && pulse > 0.05 ? this.palette.edgeBlockedPulse : this.palette.edge,
        alpha: baseAlpha + pulse * 0.4,
      });
    }

    const worldScale = this.world.scale.x;

    for (const node of this.state.nodes.values()) {
      const visual = this.visuals.get(node.id);
      const pos = this.sim.position(node.id);
      if (!visual || !pos) continue;
      visual.pulse = Math.max(0, visual.pulse - 0.03);

      const radius = node.kind === "client" ? clientRadius(node.hits) : domainRadius(node.hits);
      const scale = 1 + visual.pulse * 0.5;
      const drawRadius = radius * scale;

      visual.root.position.set(pos.x, pos.y);

      // Vektor-Kern: voller Kreis, scharf bei jedem Zoom (GPU-Tessellation).
      this.drawCore(visual, drawRadius, this.coreColor(node.blocked, node.kind));

      // Greiffläche etwas großzügiger als der Kern, damit sich Knoten leicht packen
      // lassen, aber nicht den ganzen leeren Raum für den Pan abfangen.
      visual.root.hitArea = new Circle(0, 0, Math.max(drawRadius * 1.8, 12));

      const dimmed = highlight !== null && !highlight.has(node.id);
      visual.root.alpha = node.opacity * (dimmed ? 0.12 : 1);

      // Labels in Bildschirmgröße halten (gegen-skaliert) → scharf bei jedem Zoom,
      // und knapp über dem Knoten platziert statt mitzuwachsen (Obsidian-Stil).
      // Annahme: uniformer Scale (Pan/Zoom setzt scale.set), sonst min(scale.x, scale.y).
      visual.label.scale.set(1 / worldScale);
      visual.label.position.set(0, -(drawRadius + 5 / worldScale));
      visual.label.alpha =
        node.kind === "client" ? 1 : worldScale > 1.4 || visual.pulse > 0.3 ? 0.9 : 0;

      // Cluster-Anzahl-Badge (nur Super-Knoten), bildschirmgroß und mittig.
      if (node.groupSize && node.groupSize > 1) {
        visual.badge.text = String(node.groupSize);
        visual.badge.visible = true;
        visual.badge.scale.set(1 / worldScale);
      } else {
        visual.badge.visible = false;
      }
    }
  }

  destroy(): void {
    // Unmount kann vor abgeschlossenem init() passieren (HMR, schneller Tab-Wechsel)
    if (this.app) this.app.destroy(true, { children: true });
  }
}
