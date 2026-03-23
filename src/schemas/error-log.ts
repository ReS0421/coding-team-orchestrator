import { z } from "zod";

export const ErrorLogSchema = z.object({
  session_id: z.string().min(1),
  role: z.enum(["planner", "specialist", "reviewer", "lead", "observer"]),
  error_type: z.enum([
    "parse_failure",
    "timeout",
    "conflict",
    "missing_context",
    "permission_denied",
    "internal",
    "external",
  ]),
  timestamp: z.string().datetime(),
  dispatch_rev: z.string().min(1),
  retry_count: z.number().int().nonnegative(),
  propagation_class: z.enum(["local", "session", "global"]),
  affected_tasks: z.array(z.string()),
  artifact_refs: z.array(z.string()),
  resolution: z
    .enum(["retry", "skip", "escalate", "abort", "manual"])
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
