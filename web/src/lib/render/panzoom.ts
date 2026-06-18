import type { Container } from "pixi.js";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export interface PanZoomOptions {
  /** Liefert true, wenn der Ein-Finger-Pan unterdrückt werden soll (z.B. während ein Knoten gezogen wird). */
  isSuspended?: () => boolean;
  /** Wird gerufen, sobald ein zweiter Finger einen Pinch startet – Host bricht damit einen laufenden Knoten-Drag ab. */
  onPinch?: () => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Pan, Wheel-Zoom (Maus/Trackpad) und Pinch-Zoom (Touch) für den Graphen.
 * Alles läuft über Pointer-Events, damit Maus und Finger denselben Pfad teilen.
 * Gibt eine Cleanup-Funktion zurück.
 */
export function attachPanZoom(
  canvas: HTMLCanvasElement,
  world: Container,
  opts: PanZoomOptions = {},
): () => void {
  // Aktive Zeiger (Maus/Finger) mit ihrer letzten Position in Client-Koordinaten.
  const pointers = new Map<number, Point>();
  // Letzter Fingerabstand beim Pinch – Basis für den Skalierungsfaktor.
  let lastPinchDist = 0;

  const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  /** Zoomt um einen Bildschirmpunkt (Client-Koordinaten); der Punkt bleibt fix. */
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const next = clamp(world.scale.x * factor);
    const applied = next / world.scale.x;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    world.x = px - (px - world.x) * applied;
    world.y = py - (py - world.y) * applied;
    world.scale.set(next);
  };

  const twoPointers = (): [Point, Point] => {
    const it = pointers.values();
    return [it.next().value as Point, it.next().value as Point];
  };

  const pinchDistance = (): number => {
    const [a, b] = twoPointers();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const pinchCenter = (): Point => {
    const [a, b] = twoPointers();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  };

  const onDown = (e: PointerEvent) => {
    // WICHTIG: Zeiger IMMER erfassen – auch wenn gerade ein Knoten gezogen wird.
    // Pixi startet den Knoten-Drag (capture-Listener) vor uns; würden wir hier
    // bei isSuspended abbrechen, fiele jeder Finger auf einem Knoten aus der
    // Pinch-Erkennung und Zoom käme nie zustande.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      opts.onPinch?.(); // zweiter Finger → Pinch hat Vorrang, Knoten-Drag abbrechen
      lastPinchDist = pinchDistance();
    }
  };

  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return; // Zeiger gehört nicht uns (z.B. Hover ohne Druck)
    const x = e.clientX;
    const y = e.clientY;

    // Ein Zeiger → Pan, sofern kein Knoten-Drag läuft (der hat dann Vorrang).
    // Beim Pinch (zwei Zeiger) übernimmt der Zoom; kein paralleler Pan.
    if (pointers.size === 1 && !opts.isSuspended?.()) {
      world.x += x - prev.x;
      world.y += y - prev.y;
    }

    pointers.set(e.pointerId, { x, y });

    // Zwei Zeiger → Pinch-Zoom um die Fingermitte.
    if (pointers.size === 2) {
      const dist = pinchDistance();
      if (lastPinchDist > 0 && dist > 0) {
        const center = pinchCenter();
        zoomAt(dist / lastPinchDist, center.x, center.y);
      }
      lastPinchDist = dist;
    }
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Capture wurde bereits vom Browser freigegeben (z.B. pointercancel)
    }
    // Übergang 2→1: verbleibender Zeiger wird zum Pan-Anker, sein letzter
    // Stand steht schon in der Map → kein Sprung. lastPinchDist nur halten,
    // falls wir von 3+ Zeigern auf genau 2 zurückfallen.
    if (pointers.size === 2) lastPinchDist = pinchDistance();
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return () => {
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
  };
}
