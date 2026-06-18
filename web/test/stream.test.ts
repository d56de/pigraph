import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectStream } from "../src/lib/stream.js";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 1;
  closed = false;
  private listeners = new Map<string, Array<() => void>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    const fns = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...fns, fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  close() {
    this.closed = true;
  }
}

function connect() {
  const onEvent = vi.fn();
  const onConnectionChange = vi.fn();
  const factory = vi.fn(
    (url: string) => new FakeEventSource(url) as unknown as EventSource,
  );
  const disconnect = connectStream("/events", { onEvent, onConnectionChange }, factory);
  const es = FakeEventSource.instances.at(-1)!;
  return { onEvent, onConnectionChange, disconnect, es, factory };
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connectStream", () => {
  it("parses valid events, drops invalid ones, reports connection state", () => {
    const { onEvent, onConnectionChange, disconnect, es } = connect();

    es.onopen!();
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    es.onmessage!({ data: JSON.stringify({ type: "status", state: "online" }) });
    expect(onEvent).toHaveBeenCalledWith({ type: "status", state: "online" });

    es.onmessage!({ data: "not json" });
    es.onmessage!({ data: JSON.stringify({ type: "garbage" }) });
    expect(onEvent).toHaveBeenCalledTimes(1);

    es.onerror!();
    expect(onConnectionChange).toHaveBeenCalledWith(false);

    disconnect();
    expect(es.closed).toBe(true);
  });

  it("flags offline when no events arrive within the watchdog window", () => {
    vi.useFakeTimers();
    const { onConnectionChange, disconnect, es } = connect();

    es.onopen!();
    expect(onConnectionChange).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(41_000);
    expect(onConnectionChange).toHaveBeenCalledWith(false);

    disconnect();
  });

  it("stays online while pings arrive", () => {
    vi.useFakeTimers();
    const { onConnectionChange, disconnect, es } = connect();

    es.onopen!();
    for (let elapsed = 0; elapsed < 90_000; elapsed += 15_000) {
      vi.advanceTimersByTime(15_000);
      es.emit("ping");
    }

    expect(onConnectionChange).not.toHaveBeenCalledWith(false);
    disconnect();
  });

  it("watchdog timer is cleared on disconnect", () => {
    vi.useFakeTimers();
    const { onConnectionChange, disconnect, es } = connect();

    es.onopen!();
    disconnect();
    onConnectionChange.mockClear();

    vi.advanceTimersByTime(120_000);
    expect(onConnectionChange).not.toHaveBeenCalled();
  });

  it("recreates the EventSource after a permanent failure", () => {
    vi.useFakeTimers();
    const { onConnectionChange, disconnect, es, factory } = connect();

    es.readyState = FakeEventSource.CLOSED;
    es.onerror!();
    expect(factory).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(factory).toHaveBeenCalledTimes(2);

    const es2 = FakeEventSource.instances.at(-1)!;
    es2.onopen!();
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    disconnect();
    expect(es2.closed).toBe(true);
  });

  it("does not recreate while EventSource is retrying itself", () => {
    vi.useFakeTimers();
    const { disconnect, es, factory } = connect();

    es.readyState = 0; // CONNECTING: eingebauter Retry läuft noch
    es.onerror!();

    vi.advanceTimersByTime(30_000);
    expect(factory).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("closes the stale source and reconnects when the watchdog fires", () => {
    vi.useFakeTimers();
    const { onConnectionChange, disconnect, es, factory } = connect();

    es.onopen!();
    expect(factory).toHaveBeenCalledTimes(1);

    // Toter Socket hinter dem Proxy: kein onerror, einfach Stille.
    vi.advanceTimersByTime(41_000);
    expect(onConnectionChange).toHaveBeenLastCalledWith(false);
    expect(es.closed).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(factory).toHaveBeenCalledTimes(2);

    const es2 = FakeEventSource.instances.at(-1)!;
    es2.onopen!();
    expect(onConnectionChange).toHaveBeenLastCalledWith(true);

    disconnect();
  });

  it("no recreation after disconnect", () => {
    vi.useFakeTimers();
    const { disconnect, es, factory } = connect();

    es.readyState = FakeEventSource.CLOSED;
    es.onerror!();
    disconnect();

    vi.advanceTimersByTime(60_000);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
