import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const valid = {
    PIHOLE_URL: "http://pi.hole/",
    PIHOLE_PASSWORD: "secret",
  };

  it("loads config and strips trailing slash from URL", () => {
    const cfg = loadConfig(valid);
    expect(cfg).toEqual({
      piholeUrl: "http://pi.hole",
      piholePassword: "secret",
      pollIntervalMs: 2000,
      port: 5641,
      clientNameSuffix: "fritz.box",
      dashboardPassword: "",
      sessionSecret: "",
      guestMode: false,
    });
  });

  it("respects overrides", () => {
    const cfg = loadConfig({ ...valid, POLL_INTERVAL_MS: "500", PORT: "8000", CLIENT_NAME_SUFFIX: "lan" });
    expect(cfg.pollIntervalMs).toBe(500);
    expect(cfg.port).toBe(8000);
    expect(cfg.clientNameSuffix).toBe("lan");
  });

  it("fails fast when PIHOLE_URL is missing", () => {
    expect(() => loadConfig({ PIHOLE_PASSWORD: "x" })).toThrow(/PIHOLE_URL/);
  });

  it("fails fast when PIHOLE_PASSWORD is missing", () => {
    expect(() => loadConfig({ PIHOLE_URL: "http://x" })).toThrow(/PIHOLE_PASSWORD/);
  });

  it("fails fast when PORT is not a number", () => {
    expect(() => loadConfig({ ...valid, PORT: "garbage" })).toThrow(/PORT/);
  });

  it("fails fast when POLL_INTERVAL_MS is negative", () => {
    expect(() => loadConfig({ ...valid, POLL_INTERVAL_MS: "-1" })).toThrow(/POLL_INTERVAL_MS/);
  });

  it("defaults auth fields to empty (auth off)", () => {
    const cfg = loadConfig(valid);
    expect(cfg.dashboardPassword).toBe("");
    expect(cfg.sessionSecret).toBe("");
  });

  it("reads DASHBOARD_PASSWORD and SESSION_SECRET", () => {
    const cfg = loadConfig({ ...valid, DASHBOARD_PASSWORD: "geheim", SESSION_SECRET: "s3cr3t" });
    expect(cfg.dashboardPassword).toBe("geheim");
    expect(cfg.sessionSecret).toBe("s3cr3t");
  });

  it("reads GUEST_MODE", () => {
    expect(loadConfig(valid).guestMode).toBe(false);
    expect(loadConfig({ ...valid, GUEST_MODE: "true" }).guestMode).toBe(true);
  });
});
