import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { clients24h, setClients } from "../src/lib/clients/clients-store.js";
import type { ClientStat } from "@pihole-viz/shared";

describe("clients-store", () => {
  it("starts empty and replaces the list", () => {
    expect(get(clients24h)).toEqual([]);
    const list: ClientStat[] = [{ ip: "10.0.0.1", name: "a", total: 5, blocked: 1 }];
    setClients(list);
    expect(get(clients24h)).toEqual(list);
    setClients([]);
    expect(get(clients24h)).toEqual([]);
  });
});
