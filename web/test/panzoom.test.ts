import { describe, expect, it } from "vitest";
import type { Container } from "pixi.js";
import { attachPanZoom } from "../src/lib/render/panzoom.js";

/** Minimaler Canvas-Ersatz: merkt sich Listener und feuert sie synchron. */
class FakeCanvas {
  listeners = new Map<string, Set<(e: unknown) => void>>();
  captured = new Set<number>();
  rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };

  addEventListener(type: string, fn: (e: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    if (!this.captured.has(id)) throw new Error("not captured");
    this.captured.delete(id);
  }
  fire(type: string, e: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, ...e });
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** Stub für den Pixi-Container: panzoom nutzt nur x, y und scale. */
function fakeWorld() {
  return {
    x: 0,
    y: 0,
    scale: {
      x: 1,
      y: 1,
      set(v: number) {
        this.x = v;
        this.y = v;
      },
    },
  };
}

function setup() {
  const canvas = new FakeCanvas();
  const world = fakeWorld();
  const detach = attachPanZoom(canvas as unknown as HTMLCanvasElement, world as unknown as Container);
  return { canvas, world, detach };
}

describe("attachPanZoom", () => {
  it("verschiebt die Welt beim Ein-Finger-Drag um das Delta", () => {
    const { canvas, world } = setup();
    canvas.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    canvas.fire("pointermove", { pointerId: 1, clientX: 130, clientY: 120 });
    expect(world.x).toBe(30);
    expect(world.y).toBe(20);
  });

  it("zoomt per Wheel um den Mauszeiger", () => {
    const { canvas, world } = setup();
    canvas.fire("wheel", { deltaY: -100, clientX: 200, clientY: 200 });
    // factor 1.1, Anker (200,200): x = 200 - (200-0)*1.1 = -20
    expect(world.scale.x).toBeCloseTo(1.1);
    expect(world.x).toBeCloseTo(-20);
    expect(world.y).toBeCloseTo(-20);
  });

  it("zoomt per Zwei-Finger-Pinch (Spreizen vergrößert)", () => {
    const { canvas, world } = setup();
    canvas.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    canvas.fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 100 }); // Abstand 100
    canvas.fire("pointermove", { pointerId: 2, clientX: 300, clientY: 100 }); // Abstand 200 → 2x
    expect(world.scale.x).toBeCloseTo(2);
  });

  it("kein Pinch-Sprung beim ersten Finger ohne zweiten", () => {
    const { canvas, world } = setup();
    canvas.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    canvas.fire("pointermove", { pointerId: 1, clientX: 140, clientY: 100 });
    expect(world.scale.x).toBe(1); // nur Pan, kein Zoom
    expect(world.x).toBe(40);
  });

  it("zoomt per Pinch auch über einem Knoten (Knoten-Drag wird abgebrochen)", () => {
    const canvas = new FakeCanvas();
    const world = fakeWorld();
    let dragging = false; // simuliert renderer.draggingNode
    attachPanZoom(canvas as unknown as HTMLCanvasElement, world as unknown as Container, {
      isSuspended: () => dragging,
      onPinch: () => {
        dragging = false; // ein zweiter Finger bricht den Knoten-Drag ab
      },
    });
    // Finger 1 landet auf einem Knoten → Pixi startet den Drag VOR unserem Handler:
    dragging = true;
    canvas.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    // Finger 2 landet → Pinch beginnt, obwohl noch "suspended":
    canvas.fire("pointerdown", { pointerId: 2, clientX: 200, clientY: 100 }); // Abstand 100
    canvas.fire("pointermove", { pointerId: 2, clientX: 300, clientY: 100 }); // Abstand 200 → 2x
    expect(world.scale.x).toBeCloseTo(2);
  });

  it("respektiert isSuspended für Ein-Finger-Pan (Knoten-Drag hat Vorrang)", () => {
    const canvas = new FakeCanvas();
    const world = fakeWorld();
    attachPanZoom(canvas as unknown as HTMLCanvasElement, world as unknown as Container, {
      isSuspended: () => true,
    });
    canvas.fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    canvas.fire("pointermove", { pointerId: 1, clientX: 200, clientY: 200 });
    expect(world.x).toBe(0);
    expect(world.y).toBe(0);
  });

  it("entfernt alle Listener beim Cleanup", () => {
    const { canvas, detach } = setup();
    expect(canvas.count("pointerdown")).toBe(1);
    expect(canvas.count("wheel")).toBe(1);
    detach();
    expect(canvas.count("pointerdown")).toBe(0);
    expect(canvas.count("pointermove")).toBe(0);
    expect(canvas.count("pointerup")).toBe(0);
    expect(canvas.count("pointercancel")).toBe(0);
    expect(canvas.count("wheel")).toBe(0);
  });
});
