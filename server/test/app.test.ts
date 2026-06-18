import { describe, expect, it, vi } from "vitest";
import { Broadcaster } from "../src/broadcaster.js";
import { createApp } from "../src/app.js";

const SUMMARY = {
  type: "summary",
  totalQueries: 10,
  blockedQueries: 2,
  percentBlocked: 20,
  activeClients: 3,
} as const;

describe("createApp", () => {
  it("serves /api/summary from the pihole client", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(),
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    });
    const res = await app.request("/api/summary");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(SUMMARY);
  });

  it("returns 502 when pi-hole is unreachable", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(),
      fetchSummary: vi.fn().mockRejectedValue(new Error("down")),
    });
    const res = await app.request("/api/summary");
    expect(res.status).toBe(502);
  });

  it("streams broadcast events over /events as SSE", async () => {
    const broadcaster = new Broadcaster();
    const app = createApp({
      broadcaster,
      fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    });
    const res = await app.request("/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    broadcaster.broadcast({ type: "status", state: "online" });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"state":"online"');
    await reader.cancel();
  });
});

function authedApp() {
  return createApp({
    broadcaster: new Broadcaster(),
    fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    password: "geheim",
    sessionSecret: "test-secret",
  });
}
// extrahiert "pg_session=...." aus dem Set-Cookie-Header für Folge-Requests
function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("auth", () => {
  it("blocks /api/summary and /events without a session", async () => {
    const app = authedApp();
    expect((await app.request("/api/summary")).status).toBe(401);
    expect((await app.request("/events")).status).toBe(401);
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const app = authedApp();
    expect((await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "falsch" }),
    })).status).toBe(401);

    const ok = await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "geheim" }),
    });
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect(cookie).toContain("pg_session=");

    const res = await app.request("/api/summary", { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("/api/me reflects auth state", async () => {
    const app = authedApp();
    await expect((await app.request("/api/me")).json()).resolves.toEqual({ authenticated: false, role: null, guestEnabled: false });
    const ok = await app.request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "geheim" }),
    });
    const me = await app.request("/api/me", { headers: { cookie: cookieFrom(ok) } });
    await expect(me.json()).resolves.toEqual({ authenticated: true, role: "user", guestEnabled: false });
  });

  it("stays open when no password is configured", async () => {
    const app = createApp({ broadcaster: new Broadcaster(), fetchSummary: vi.fn().mockResolvedValue(SUMMARY) });
    expect((await app.request("/api/summary")).status).toBe(200);
    await expect((await app.request("/api/me")).json()).resolves.toEqual({ authenticated: true, role: "open", guestEnabled: false });
  });
});

function guestApp() {
  return createApp({
    broadcaster: new Broadcaster(),
    fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
    password: "geheim",
    sessionSecret: "test-secret",
    guestMode: true,
  });
}

describe("guest mode", () => {
  it("issues a guest session that reaches the data routes", async () => {
    const app = guestApp();
    const g = await app.request("/api/guest", { method: "POST" });
    expect(g.status).toBe(200);
    const cookie = cookieFrom(g);
    expect(cookie).toContain("pg_session=");
    expect((await app.request("/api/summary", { headers: { cookie } })).status).toBe(200);
  });

  it("/api/me reports the guest role and guestEnabled", async () => {
    const app = guestApp();
    await expect((await app.request("/api/me")).json()).resolves.toEqual({
      authenticated: false, role: null, guestEnabled: true,
    });
    const g = await app.request("/api/guest", { method: "POST" });
    const me = await app.request("/api/me", { headers: { cookie: cookieFrom(g) } });
    await expect(me.json()).resolves.toEqual({ authenticated: true, role: "guest", guestEnabled: true });
  });

  it("404s /api/guest and reports guestEnabled:false when GUEST_MODE is off", async () => {
    const app = createApp({
      broadcaster: new Broadcaster(), fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
      password: "geheim", sessionSecret: "test-secret",
    });
    expect((await app.request("/api/guest", { method: "POST" })).status).toBe(404);
    await expect((await app.request("/api/me")).json()).resolves.toEqual({
      authenticated: false, role: null, guestEnabled: false,
    });
  });

  it("anonymizes the event stream for a guest", async () => {
    const broadcaster = new Broadcaster();
    const app = createApp({
      broadcaster, fetchSummary: vi.fn().mockResolvedValue(SUMMARY),
      password: "geheim", sessionSecret: "test-secret", guestMode: true,
    });
    const g = await app.request("/api/guest", { method: "POST" });
    const res = await app.request("/events", { headers: { cookie: cookieFrom(g) } });
    const reader = res.body!.getReader();
    broadcaster.broadcast({
      type: "query", id: 1, time: 1, domain: "ads.example.com",
      clientIp: "10.0.0.5", clientName: "laptop", blocked: false, status: "FORWARDED",
    });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).not.toContain("ads.example.com");
    expect(text).not.toContain("laptop");
    expect(text).toContain("site-1");
    expect(text).toContain("Client 1");
    await reader.cancel();
  });
});
