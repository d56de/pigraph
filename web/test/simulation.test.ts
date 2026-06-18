import { describe, expect, it } from "vitest";
import type { QueryEvent } from "@pihole-viz/shared";
import { applyQuery, emptyGraph } from "../src/lib/graph/store.js";
import { GraphSimulation } from "../src/lib/render/simulation.js";

const CLIENT_ID = "client:10.0.0.1";

function graphWithEdge() {
  const query: QueryEvent = {
    type: "query",
    id: 1,
    time: 0,
    domain: "x.com",
    clientIp: "10.0.0.1",
    clientName: "pc",
    blocked: false,
    status: "FORWARDED",
  };
  return applyQuery(emptyGraph(), query, 0);
}

describe("GraphSimulation drag pinning", () => {
  it("keeps a node fixed at the drop position after release (stays put until reload)", () => {
    const sim = new GraphSimulation(800, 600);
    sim.sync(graphWithEdge());

    sim.pin(CLIENT_ID, 123, 456);
    sim.step();
    expect(sim.position(CLIENT_ID)).toEqual({ x: 123, y: 456 });

    sim.release();
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.position(CLIENT_ID)).toEqual({ x: 123, y: 456 });
  });

  it("frees the node again after unpin (a plain click must not freeze it)", () => {
    const sim = new GraphSimulation(800, 600);
    sim.sync(graphWithEdge());

    sim.pin(CLIENT_ID, 123, 456);
    sim.step();
    expect(sim.position(CLIENT_ID)).toEqual({ x: 123, y: 456 });

    sim.unpin(CLIENT_ID);
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.position(CLIENT_ID)).not.toEqual({ x: 123, y: 456 });
  });
});
