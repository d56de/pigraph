import { z } from "zod";

export const QueryEventSchema = z.object({
  type: z.literal("query"),
  id: z.number().int().nonnegative(),
  time: z.number().nonnegative(),
  domain: z.string().min(1),
  clientIp: z.string().min(1),
  clientName: z.string().min(1),
  blocked: z.boolean(),
  status: z.string(),
  recordType: z.string().optional(),
});
export type QueryEvent = z.infer<typeof QueryEventSchema>;

export const SummaryEventSchema = z.object({
  type: z.literal("summary"),
  totalQueries: z.number().nonnegative(),
  blockedQueries: z.number().nonnegative(),
  percentBlocked: z.number().min(0).max(100),
  activeClients: z.number().nonnegative(),
  cached: z.number().nonnegative().optional(),
  forwarded: z.number().nonnegative().optional(),
});
export type SummaryEvent = z.infer<typeof SummaryEventSchema>;

export const StatusEventSchema = z.object({
  type: z.literal("status"),
  state: z.enum(["online", "offline"]),
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;

export const ClientStatSchema = z.object({
  ip: z.string().min(1),
  name: z.string().min(1),
  total: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type ClientStat = z.infer<typeof ClientStatSchema>;

export const ClientsEventSchema = z.object({
  type: z.literal("clients"),
  generatedAt: z.number().nonnegative(),
  clients: z.array(ClientStatSchema),
});
export type ClientsEvent = z.infer<typeof ClientsEventSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
  QueryEventSchema,
  SummaryEventSchema,
  StatusEventSchema,
  ClientsEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
