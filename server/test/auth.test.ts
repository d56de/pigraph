import { describe, expect, it } from "vitest";
import { verifyPassword } from "../src/auth.js";

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword("geheim", "geheim")).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyPassword("falsch", "geheim")).toBe(false);
  });
  it("rejects against an empty expected (auth off)", () => {
    expect(verifyPassword("anything", "")).toBe(false);
  });
  it("rejects different-length inputs without throwing", () => {
    expect(verifyPassword("x", "geheim")).toBe(false);
  });
});
