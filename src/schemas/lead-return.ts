import { z } from "zod";
import { SpecialistSubmissionSchema } from "./specialist-submission.js";
import { ManifestPatchSetSchema } from "./manifest-patch.js";

export const RescueLogEntrySchema = z.object({
  task_id: z.string().min(1),
  trigger: z.string().min(1),
  timestamp: z.string().datetime(),
}).passthrough();

export const EscalationLogEntrySchema = z.object({
  task_id: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.string().datetime(),
}).passthrough();

export const LeadReturnSchema = z.object({
  final_merge_candidate: z.string().min(1),
  execution_summary: z.string().min(1),
  specialist_results: z.array(SpecialistSubmissionSchema),
  manifest_updates: ManifestPatchSetSchema,
  rescue_log: z.array(RescueLogEntrySchema).optional(),
  escalation_log: z.array(EscalationLogEntrySchema).optional(),
});

export type LeadReturn = z.infer<typeof LeadReturnSchema>;

export function validateLeadReturn(data: unknown): LeadReturn {
  return LeadReturnSchema.parse(data);
}

export function safeValidateLeadReturn(data: unknown) {
  return LeadReturnSchema.safeParse(data);
}
