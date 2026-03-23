import { z } from "zod";

export const ErrorLogSchema = z.object({
  session_id: z.string().min(1),
  role: z.enum(["planner", "specialist", "execution_lead", "shared_owner", "reviewer"]),
  error_type: z.enum([
    "timeout",
    "crash",
    "stalled",
    "blocked",
    "needs_context",
    "malformed_return",
    "silent_failure",
  ]),
  timestamp: z.string().datetime(),
  dispatch_rev: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  propagation_class: z.enum(["contained", "dependent_hold", "global_escalation"]),
  affected_tasks: z.array(z.string()),
  artifact_refs: z.array(z.string()),
  resolution: z
    .enum(["retry", "reassign", "escalate", "abort", "salvage"])
    .optional(),
  notes: z.string().optional(),
});

export type ErrorLog = z.infer<typeof ErrorLogSchema>;

export function validateErrorLog(data: unknown): ErrorLog {
  return ErrorLogSchema.parse(data);
}

export function safeValidateErrorLog(data: unknown) {
  return ErrorLogSchema.safeParse(data);
}
