import { ServerEventSchema, type ServerEvent } from "@pihole-viz/shared";

export interface StreamHandlers {
  onEvent: (event: ServerEvent) => void;
  onConnectionChange: (connected: boolean) => void;
}

type EventSourceFactory = (url: string) => EventSource;

/** Keine Daten/Pings innerhalb dieses Fensters → Verbindung gilt als tot. */
const WATCHDOG_MS = 40_000;
const WATCHDOG_CHECK_MS = 5_000;
/** Wartezeit bis zum manuellen Neuaufbau nach permanentem EventSource-Fehler. */
const RECONNECT_DELAY_MS = 5_000;
/** EventSource.CLOSED — das Global fehlt in der Node-Testumgebung. */
const CLOSED = 2;

export function connectStream(
  url: string,
  handlers: StreamHandlers,
  createEventSource: EventSourceFactory = (u) => new EventSource(u),
): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastSeen = Date.now();
  let connected = false;

  const markOnline = () => {
    lastSeen = Date.now();
    if (!connected) {
      connected = true;
      handlers.onConnectionChange(true);
    }
  };
  const markOffline = () => {
    if (connected) {
      connected = false;
      handlers.onConnectionChange(false);
    }
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (disposed) return;
    // Frischer Versuch bekommt ein volles Watchdog-Fenster — sonst feuert
    // der Watchdog bei längerem Ausfall alle 5s erneut und stapelt Closes.
    lastSeen = Date.now();
    source = createEventSource(url);

    source.onopen = () => markOnline();

    source.onerror = () => {
      markOffline();
      // EventSource retried selbst nur bei Netzabbrüchen; nach HTTP-Fehlern
      // (readyState CLOSED, z. B. 502 vom Dev-Proxy bei totem Backend)
      // gibt er dauerhaft auf → manuell neu verbinden.
      if (source?.readyState === CLOSED) scheduleReconnect();
    };

    // Server sendet `event: ping` alle 15s — landet nicht in onmessage,
    // sondern nur in einem benannten Listener.
    source.addEventListener("ping", () => markOnline());

    source.onmessage = (message) => {
      markOnline();
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        console.warn("[stream] verworfen: kein JSON", message.data);
        return;
      }
      const parsed = ServerEventSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn("[stream] verworfen: Schema-Fehler", parsed.error.issues);
        return;
      }
      handlers.onEvent(parsed.data);
    };
  };
  connect();

  // Stiller Tod hinter einem Proxy (Socket bleibt offen, onerror feuert nie):
  // ohne Lebenszeichen innerhalb von WATCHDOG_MS gilt die Verbindung als tot —
  // dann selbst schließen und neu verbinden, der stale Socket heilt nie.
  const watchdog = setInterval(() => {
    if (Date.now() - lastSeen >= WATCHDOG_MS) {
      markOffline();
      source?.close();
      scheduleReconnect();
    }
  }, WATCHDOG_CHECK_MS);

  return () => {
    disposed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearInterval(watchdog);
    source?.close();
  };
}
