import { z } from "zod";

export const EventTypeSchema = z.enum([
  "spawned",
  "return_validated",
  "patch_committed",
  "checkpoint_created",
  "error",
  "completed",
  // Sprint 3: shared protocol events
  "owner_spawn",
  "owner_commit",
  "consumer_blocked",
  "shared_redispatch",
  "tier3_escalation",
  "acting_lead_assigned",
]);

export const EventLogEntrySchema = z
  .object({
    ts: z.string().datetime(),
    event: EventTypeSchema,
    session_id: z.string().optional(),
    role: z.string().optional(),
    dispatch_rev: z.number().int().optional(),
  })
  .passthrough(); // 이벤트별 추가 필드 허용

export type EventType = z.infer<typeof EventTypeSchema>;
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

export function validateEventLogEntry(data: unknown): EventLogEntry {
  return EventLogEntrySchema.parse(data);
}

export function safeValidateEventLogEntry(data: unknown) {
  return EventLogEntrySchema.safeParse(data);
}
