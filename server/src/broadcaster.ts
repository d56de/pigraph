import type { ServerEvent } from "@pihole-viz/shared";

type Subscriber = (event: ServerEvent) => void;

export class Broadcaster {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  broadcast(event: ServerEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (err) {
        console.error("[broadcaster] subscriber threw:", err);
      }
    }
  }
}
