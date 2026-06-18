import type { ClientsEvent, QueryEvent, ServerEvent, SummaryEvent } from "@pihole-viz/shared";

export interface PollerClient {
  fetchQueriesSince(fromSeconds: number): Promise<QueryEvent[]>;
  fetchSummary(): Promise<SummaryEvent>;
  fetchTopClients?(count?: number): Promise<ClientsEvent>;
}

export interface PollerOptions {
  client: PollerClient;
  pollIntervalMs: number;
  summaryEveryNPolls: number;
  topClientsEveryNPolls?: number;
  onEvent: (event: ServerEvent) => void;
  nowSeconds?: () => number;
}

const CURSOR_OVERLAP_S = 5;
const MAX_SEEN_IDS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export class QueryPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly seenIds = new Set<number>();
  private lastTime: number;
  private failures = 0;
  private polls = 0;
  private online = true;
  private stopped = false;
  private generation = 0;

  constructor(private readonly opts: PollerOptions) {
    const now = opts.nowSeconds?.() ?? Date.now() / 1000;
    this.lastTime = now - 60; // beim Start: letzte Minute anzeigen
  }

  start(): void {
    this.stopped = false;
    this.generation += 1;
    this.schedule(0, this.generation);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number, gen: number): void {
    if (gen !== this.generation || this.stopped) return;
    this.timer = setTimeout(() => void this.poll(gen), delayMs);
  }

  private async poll(gen: number): Promise<void> {
    try {
      const events = await this.opts.client.fetchQueriesSince(this.lastTime - CURSOR_OVERLAP_S);
      const fresh = events
        .filter((e) => !this.seenIds.has(e.id))
        .sort((a, b) => a.time - b.time);
      for (const e of fresh) {
        this.seenIds.add(e.id);
        if (e.time > this.lastTime) this.lastTime = e.time;
        this.opts.onEvent(e);
      }
      this.pruneSeen();

      this.polls += 1;
      if (this.opts.summaryEveryNPolls <= 1 || this.polls % this.opts.summaryEveryNPolls === 1) {
        this.opts.onEvent(await this.opts.client.fetchSummary());
      }

      const tcEvery = this.opts.topClientsEveryNPolls ?? 0;
      if (tcEvery >= 1 && (tcEvery <= 1 || this.polls % tcEvery === 1) && this.opts.client.fetchTopClients) {
        // Eigener, langsamer Takt; ein Fehler hier darf den Query-Stream nicht kippen.
        try {
          this.opts.onEvent(await this.opts.client.fetchTopClients());
        } catch (err) {
          console.error("[poller] top_clients fehlgeschlagen:", err);
        }
      }

      if (!this.online) {
        this.online = true;
        this.opts.onEvent({ type: "status", state: "online" });
      }
      this.failures = 0;
      this.schedule(this.opts.pollIntervalMs, gen);
    } catch (err) {
      this.failures += 1;
      if (this.online) {
        this.online = false;
        this.opts.onEvent({ type: "status", state: "offline" });
      }
      console.error(`[poller] Fehler (Versuch ${this.failures}):`, err);
      const backoff = Math.min(this.opts.pollIntervalMs * 2 ** this.failures, MAX_BACKOFF_MS);
      this.schedule(backoff, gen);
    }
  }

  private pruneSeen(): void {
    if (this.seenIds.size <= MAX_SEEN_IDS) return;
    const excess = this.seenIds.size - MAX_SEEN_IDS;
    let i = 0;
    for (const id of this.seenIds) {
      if (i++ >= excess) break;
      this.seenIds.delete(id);
    }
  }
}
