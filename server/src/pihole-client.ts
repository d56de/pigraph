import type { ClientsEvent, ClientStat, QueryEvent, SummaryEvent } from "@pihole-viz/shared";
import { stripDnsSuffix } from "./client-name.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BLOCKED_STATUSES = new Set([
  "GRAVITY",
  "REGEX",
  "DENYLIST",
  "GRAVITY_CNAME",
  "REGEX_CNAME",
  "DENYLIST_CNAME",
  "EXTERNAL_BLOCKED_IP",
  "EXTERNAL_BLOCKED_NULL",
  "EXTERNAL_BLOCKED_NXRA",
  "EXTERNAL_BLOCKED_EDE15",
  "SPECIAL_DOMAIN",
]);

interface RawQuery {
  id: number;
  time: number;
  domain: string;
  type?: string | null;
  status?: string | null;
  client?: { ip?: string | null; name?: string | null } | null;
}

export class PiholeClient {
  private sid: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly fetchFn: FetchLike = fetch,
    private readonly nameSuffix = "fritz.box",
  ) {}

  private async authenticate(): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });
    if (!res.ok) {
      throw new Error(`Pi-hole Auth fehlgeschlagen (HTTP ${res.status}) — App-Passwort prüfen`);
    }
    const body = (await res.json()) as { session?: { valid?: boolean; sid?: string } };
    const sid = body.session?.valid ? body.session.sid : undefined;
    if (!sid) throw new Error("Pi-hole Auth: keine gültige Session erhalten");
    this.sid = sid;
    return sid;
  }

  private async request(path: string): Promise<unknown> {
    const sid = this.sid ?? (await this.authenticate());
    let res = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { "X-FTL-SID": sid },
    });
    if (res.status === 401) {
      this.sid = null;
      const fresh = await this.authenticate();
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { "X-FTL-SID": fresh },
      });
    }
    if (!res.ok) {
      throw new Error(`Pi-hole API ${path} antwortete HTTP ${res.status}`);
    }
    return res.json();
  }

  async fetchQueriesSince(fromSeconds: number): Promise<QueryEvent[]> {
    // length=1000 deckt ~500 Queries/s bei 2s-Polling ab; was darüber liegt,
    // fällt still weg — für ein Heimnetz irrelevant, sonst hier paginieren.
    const data = (await this.request(
      `/api/queries?from=${Math.floor(fromSeconds)}&length=1000`,
    )) as { queries?: RawQuery[] };
    const queries = Array.isArray(data.queries) ? data.queries : [];
    return queries.map((q) => {
      const ip = q.client?.ip ?? "unknown";
      return {
        type: "query" as const,
        id: q.id,
        time: q.time,
        domain: q.domain,
        clientIp: ip,
        clientName: stripDnsSuffix(q.client?.name ?? ip, this.nameSuffix),
        blocked: BLOCKED_STATUSES.has(q.status ?? ""),
        status: q.status ?? "UNKNOWN",
        recordType: q.type ?? undefined,
      };
    });
  }

  async fetchSummary(): Promise<SummaryEvent> {
    const data = (await this.request("/api/stats/summary")) as {
      queries?: { total?: number; blocked?: number; percent_blocked?: number; cached?: number; forwarded?: number };
      clients?: { active?: number };
    };
    return {
      type: "summary",
      totalQueries: data.queries?.total ?? 0,
      blockedQueries: data.queries?.blocked ?? 0,
      percentBlocked: data.queries?.percent_blocked ?? 0,
      activeClients: data.clients?.active ?? 0,
      cached: data.queries?.cached ?? 0,
      forwarded: data.queries?.forwarded ?? 0,
    };
  }

  async fetchTopClients(count = 50): Promise<ClientsEvent> {
    type Raw = { clients?: Array<{ ip?: string | null; name?: string | null; count?: number | null }> };
    const [totalRes, blockedRes] = (await Promise.all([
      this.request(`/api/stats/top_clients?count=${count}`),
      this.request(`/api/stats/top_clients?blocked=true&count=${count}`),
    ])) as [Raw, Raw];

    const blockedByIp = new Map<string, number>();
    for (const c of blockedRes.clients ?? []) {
      if (c.ip) blockedByIp.set(c.ip, c.count ?? 0);
    }
    const clients: ClientStat[] = (totalRes.clients ?? [])
      .filter((c): c is { ip: string; name?: string | null; count?: number | null } => !!c.ip)
      .map((c) => ({
        ip: c.ip,
        name: stripDnsSuffix(c.name && c.name.length > 0 ? c.name : c.ip, this.nameSuffix),
        total: c.count ?? 0,
        blocked: blockedByIp.get(c.ip) ?? 0,
      }));

    return { type: "clients", generatedAt: Math.floor(Date.now() / 1000), clients };
  }

  async logout(): Promise<void> {
    if (!this.sid) return;
    await this.fetchFn(`${this.baseUrl}/api/auth`, {
      method: "DELETE",
      headers: { "X-FTL-SID": this.sid },
    }).catch(() => undefined);
    this.sid = null;
  }
}
