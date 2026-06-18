import { Hono } from "hono";
import type { Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { ServerEvent, SummaryEvent } from "@pihole-viz/shared";
import type { Broadcaster } from "./broadcaster.js";
import { SESSION_COOKIE, SESSION_MAX_AGE, verifyPassword } from "./auth.js";
import { createAnonymizer } from "./anonymize.js";

export interface AppDeps {
  broadcaster: Broadcaster;
  fetchSummary: () => Promise<SummaryEvent>;
  password?: string; // leer/undefined = Auth aus
  sessionSecret?: string;
  guestMode?: boolean;
}

const SSE_PING_INTERVAL_MS = 15_000;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const password = deps.password ?? "";
  const secret = deps.sessionSecret ?? "";
  const authEnabled = password.length > 0;
  const guestEnabled = authEnabled && !!deps.guestMode;
  const anonymizer = createAnonymizer();

  const sessionRole = async (c: Context): Promise<"user" | "guest" | null> => {
    const v = await getSignedCookie(c, secret, SESSION_COOKIE);
    if (v === "user") return "user";
    if (v === "guest") return "guest";
    return null;
  };

  const requireAuth = async (c: Context, next: Next) => {
    if (!authEnabled) return next();
    if (await sessionRole(c)) return next();
    return c.json({ error: "nicht angemeldet" }, 401);
  };

  app.post("/api/login", async (c) => {
    if (!authEnabled) return c.json({ ok: true });
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    if (verifyPassword(String(body.password ?? ""), password)) {
      await setSignedCookie(c, SESSION_COOKIE, "user", secret, {
        httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE,
      });
      return c.json({ ok: true });
    }
    return c.json({ error: "falsches Passwort" }, 401);
  });

  app.post("/api/guest", async (c) => {
    if (!guestEnabled) return c.json({ error: "nicht verfügbar" }, 404);
    await setSignedCookie(c, SESSION_COOKIE, "guest", secret, {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_MAX_AGE,
    });
    return c.json({ ok: true });
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    if (!authEnabled) return c.json({ authenticated: true, role: "open", guestEnabled: false });
    const role = await sessionRole(c);
    return c.json({ authenticated: role !== null, role, guestEnabled });
  });

  // Geschützte Datenrouten — Middleware VOR den Handlern registrieren:
  app.use("/api/summary", requireAuth);
  app.use("/events", requireAuth);

  app.get("/api/summary", async (c) => {
    try {
      return c.json(await deps.fetchSummary());
    } catch (err) {
      console.error("[summary]", err);
      return c.json({ error: "Pi-hole nicht erreichbar" }, 502);
    }
  });

  app.get("/events", async (c) => {
    const role = authEnabled ? await sessionRole(c) : null;
    return streamSSE(c, async (stream) => {
      const transform = (event: ServerEvent): ServerEvent | null =>
        role === "guest" ? anonymizer.anonymizeEvent(event) : event;
      let open = true;
      const unsubscribe = deps.broadcaster.subscribe((event) => {
        const out = transform(event);
        if (out) void stream.writeSSE({ data: JSON.stringify(out) });
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      while (open) {
        await stream.sleep(SSE_PING_INTERVAL_MS);
        await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  return app;
}
