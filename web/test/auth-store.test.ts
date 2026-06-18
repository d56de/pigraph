import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { authed, checkAuth, login, logout, role, guestEnabled, loginAsGuest } from "../src/lib/auth/auth-store.js";

afterEach(() => vi.restoreAllMocks());

describe("auth-store", () => {
  it("checkAuth sets authed from /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) }));
    await checkAuth();
    expect(get(authed)).toBe(true);
  });

  it("login returns true and sets authed on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    expect(await login("geheim")).toBe(true);
    expect(get(authed)).toBe(true);
  });

  it("login returns false and clears authed on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) }));
    expect(await login("falsch")).toBe(false);
    expect(get(authed)).toBe(false);
  });

  it("logout clears authed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await logout();
    expect(get(authed)).toBe(false);
  });

  it("checkAuth reads role and guestEnabled from /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ authenticated: false, role: null, guestEnabled: true }),
    }));
    await checkAuth();
    expect(get(authed)).toBe(false);
    expect(get(role)).toBe(null);
    expect(get(guestEnabled)).toBe(true);
  });

  it("login sets role=user on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    await login("geheim");
    expect(get(role)).toBe("user");
  });

  it("loginAsGuest sets role=guest on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    expect(await loginAsGuest()).toBe(true);
    expect(get(authed)).toBe(true);
    expect(get(role)).toBe("guest");
  });

  it("loginAsGuest returns false on 404 and leaves role null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await loginAsGuest()).toBe(false);
    expect(get(role)).toBe(null);
  });
});
