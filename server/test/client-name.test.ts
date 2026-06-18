import { describe, expect, it } from "vitest";
import { stripDnsSuffix } from "../src/client-name.js";

describe("stripDnsSuffix", () => {
  it("strips the configured local domain suffix", () => {
    expect(stripDnsSuffix("iPhone.fritz.box", "fritz.box")).toBe("iPhone");
    expect(stripDnsSuffix("wohnzimmer-tv.fritz.box", "fritz.box")).toBe("wohnzimmer-tv");
  });

  it("matches the suffix case-insensitively", () => {
    expect(stripDnsSuffix("Host.FRITZ.BOX", "fritz.box")).toBe("Host");
  });

  it("leaves non-matching names and bare IPs untouched", () => {
    expect(stripDnsSuffix("192.168.1.10", "fritz.box")).toBe("192.168.1.10");
    expect(stripDnsSuffix("host.lan", "fritz.box")).toBe("host.lan");
  });

  it("returns the name unchanged when the suffix is empty", () => {
    expect(stripDnsSuffix("iPhone.fritz.box", "")).toBe("iPhone.fritz.box");
  });
});
