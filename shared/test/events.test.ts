import { describe, expect, it } from "vitest";
import { ClientsEventSchema, QueryEventSchema, ServerEventSchema, SummaryEventSchema } from "../src/index.js";

describe("event schemas", () => {
  const query = {
    type: "query",
    id: 42,
    time: 1760000000.5,
    domain: "ads.example.com",
    clientIp: "192.168.1.10",
    clientName: "iphone",
    blocked: true,
    status: "GRAVITY",
  };

  it("accepts a valid query event", () => {
    expect(QueryEventSchema.parse(query)).toEqual(query);
  });

  it("rejects a query event without domain", () => {
    const { domain: _domain, ...rest } = query;
    expect(QueryEventSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a query event with negative id", () => {
    expect(QueryEventSchema.safeParse({ ...query, id: -1 }).success).toBe(
      false,
    );
  });

  it("rejects a summary with percentBlocked > 100", () => {
    const summary = {
      type: "summary",
      totalQueries: 100,
      blockedQueries: 18,
      percentBlocked: 101,
      activeClients: 5,
    };
    expect(ServerEventSchema.safeParse(summary).success).toBe(false);
  });

  it("discriminates the union by type", () => {
    const summary = {
      type: "summary",
      totalQueries: 100,
      blockedQueries: 18,
      percentBlocked: 18,
      activeClients: 5,
    };
    const status = { type: "status", state: "offline" };
    expect(ServerEventSchema.parse(summary)).toEqual(summary);
    expect(ServerEventSchema.parse(status)).toEqual(status);
    expect(ServerEventSchema.safeParse({ type: "nope" }).success).toBe(false);
  });

  it("accepts an optional recordType on a query event", () => {
    const parsed = QueryEventSchema.parse({ ...query, recordType: "PTR" });
    expect(parsed.recordType).toBe("PTR");
  });

  it("still accepts a query event without recordType", () => {
    expect(QueryEventSchema.parse(query).recordType).toBeUndefined();
  });
});

describe("ClientsEventSchema", () => {
  const valid = {
    type: "clients",
    generatedAt: 1_700_000_000,
    clients: [{ ip: "192.168.1.10", name: "iphone", total: 1234, blocked: 56 }],
  };

  it("accepts a valid clients event", () => {
    expect(ClientsEventSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty client list", () => {
    expect(ClientsEventSchema.parse({ ...valid, clients: [] }).clients).toEqual([]);
  });

  it("rejects a negative total", () => {
    const bad = { ...valid, clients: [{ ...valid.clients[0], total: -1 }] };
    expect(ClientsEventSchema.safeParse(bad).success).toBe(false);
  });

  it("is part of the ServerEvent union", () => {
    expect(ServerEventSchema.parse(valid).type).toBe("clients");
  });
});

describe("SummaryEvent cached/forwarded", () => {
  it("parses cached and forwarded", () => {
    const e = SummaryEventSchema.parse({
      type: "summary", totalQueries: 100, blockedQueries: 8, percentBlocked: 8,
      activeClients: 5, cached: 60, forwarded: 32,
    });
    expect(e.cached).toBe(60);
    expect(e.forwarded).toBe(32);
  });

  it("leaves cached/forwarded undefined when absent (older server)", () => {
    const e = SummaryEventSchema.parse({
      type: "summary", totalQueries: 1, blockedQueries: 0, percentBlocked: 0, activeClients: 1,
    });
    expect(e.cached).toBeUndefined();
    expect(e.forwarded).toBeUndefined();
  });
});
