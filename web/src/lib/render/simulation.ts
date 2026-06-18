import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphState } from "../graph/store.js";

export interface SimNode extends SimulationNodeDatum {
  id: string;
}

type SimLink = SimulationLinkDatum<SimNode> & { id: string };

export class GraphSimulation {
  private readonly sim: Simulation<SimNode, SimLink>;
  private readonly byId = new Map<string, SimNode>();
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private dragging = false;

  constructor(private width: number, private height: number) {
    this.sim = forceSimulation<SimNode>([])
      .force("charge", forceManyBody().strength(-90))
      .force(
        "link",
        forceLink<SimNode, SimLink>([]).id((d) => d.id).distance(70).strength(0.35),
      )
      .force("collide", forceCollide(16))
      .force("center", forceCenter(width / 2, height / 2).strength(0.04))
      .alphaDecay(0.028)
      // Weniger Dämpfung → Knoten schwingen beim Loslassen nach (Obsidian-Bounce).
      .velocityDecay(0.3)
      .stop();
  }

  /** Knoten an die Cursor-Position heften und die Sim warmhalten (Drag). */
  pin(id: string, x: number, y: number): void {
    const node = this.byId.get(id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
    this.dragging = true;
    this.sim.alpha(0.3); // Nachbarn folgen über die Link-Federn
  }

  /** Drag ohne Versatz beenden (reiner Klick) → Knoten wird wieder frei. */
  unpin(id: string): void {
    const node = this.byId.get(id);
    if (!node) return;
    node.fx = null;
    node.fy = null;
    this.dragging = false;
    this.sim.alpha(0.3);
  }

  /** Nach echtem Ziehen loslassen → Knoten bleibt an der Stelle fixiert. */
  release(): void {
    this.dragging = false;
    this.sim.alpha(0.3); // Nachbarn sortieren sich um die neue Fixposition
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sim.force("center", forceCenter(width / 2, height / 2).strength(0.04));
  }

  /** Sim-Knoten mit dem Store abgleichen; bestehende behalten ihre Position. */
  sync(state: GraphState): void {
    let changed = false;

    for (const id of this.byId.keys()) {
      if (!state.nodes.has(id)) {
        this.byId.delete(id);
        changed = true;
      }
    }

    for (const node of state.nodes.values()) {
      if (!this.byId.has(node.id)) {
        // Neue Domains starten nahe einem verbundenen Client (weniger Springen)
        const edge = [...state.edges.values()].find((e) => e.target === node.id);
        const anchor = edge ? this.byId.get(edge.source) : undefined;
        const jitter = () => (Math.random() - 0.5) * 60;
        this.byId.set(node.id, {
          id: node.id,
          x: (anchor?.x ?? this.width / 2) + jitter(),
          y: (anchor?.y ?? this.height / 2) + jitter(),
        });
        changed = true;
      }
    }

    const prevLinkCount = this.links.length;
    this.nodes = [...this.byId.values()];
    this.sim.nodes(this.nodes);
    const linkCountChanged = state.edges.size !== prevLinkCount;
    if (changed || linkCountChanged) {
      this.links = [...state.edges.values()].map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      }));
      (this.sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(this.links);
      this.sim.alpha(0.5);
    }
  }

  /** Einen Physik-Schritt rechnen (vom Pixi-Ticker aufgerufen). */
  step(): void {
    // Während eines Drags immer ticken, damit der gehaltene Knoten und seine
    // Nachbarn dem Cursor live folgen, auch wenn alpha zwischendurch absackt.
    if (this.dragging || this.sim.alpha() > this.sim.alphaMin()) this.sim.tick();
  }

  position(id: string): { x: number; y: number } | undefined {
    const node = this.byId.get(id);
    return node ? { x: node.x ?? 0, y: node.y ?? 0 } : undefined;
  }
}
