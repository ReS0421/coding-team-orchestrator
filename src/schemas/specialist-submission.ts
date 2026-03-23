import { z } from "zod";

export const EvidenceSchema = z.object({
  build_pass: z.boolean(),
  test_pass: z.boolean(),
  test_summary: z.string().min(1),
});

export const SpecialistSubmissionSchema = z.object({
  status: z.enum(["done", "done_with_concerns", "needs_context", "blocked"]),
  touched_files: z.array(z.string()),
  changeset: z.string().min(1),
  delta_stub: z.string().min(1),
  evidence: EvidenceSchema,
  risk_notes: z.string().optional(),
  shared_amendment_flag: z.boolean().optional(),
  blocked_reason: z.string().optional(),
});

export type SpecialistSubmission = z.infer<typeof SpecialistSubmissionSchema>;

export function validateSpecialistSubmission(data: unknown): SpecialistSubmission {
  return SpecialistSubmissionSchema.parse(data);
}

export function safeValidateSpecialistSubmission(data: unknown) {
  return SpecialistSubmissionSchema.safeParse(data);
}
