import { z } from "zod";

export const EvidenceSchema = z.object({
  build_pass: z.boolean(),
  test_pass: z.boolean(),
  test_summary: z.string().min(1),
});

// Sprint 3: structured blocked info for shared protocol automation
export const BlockedOnSchema = z
  .object({
    reason: z.enum(["shared_pending", "dependency", "context_missing"]),
    surface: z.string().optional(),
    owner_id: z.string().optional(),
  })
  .refine(
    (data) =>
      data.reason !== "shared_pending" ||
      (data.surface != null && data.surface.length > 0),
    {
      message: "surface is required when reason is shared_pending",
      path: ["surface"],
    },
  )
  .refine(
    (data) =>
      data.reason !== "shared_pending" ||
      (data.owner_id != null && data.owner_id.length > 0),
    {
      message: "owner_id is required when reason is shared_pending",
      path: ["owner_id"],
    },
  );

export const SpecialistSubmissionSchema = z.object({
  status: z.enum(["done", "done_with_concerns", "needs_context", "blocked"]),
  touched_files: z.array(z.string()),
  changeset: z.string().min(1),
  delta_stub: z.string().min(1),
  evidence: EvidenceSchema,
  risk_notes: z.string().optional(),
  shared_amendment_flag: z.boolean().optional(),
  blocked_reason: z.string().optional(), // 범용 사유 텍스트 (사람 읽기용)
  blocked_on: BlockedOnSchema.optional(), // 구조화 차단 정보 (기계 소비용)
});

export type BlockedOn = z.infer<typeof BlockedOnSchema>;
export type SpecialistSubmission = z.infer<typeof SpecialistSubmissionSchema>;

export function validateSpecialistSubmission(
  data: unknown,
): SpecialistSubmission {
  return SpecialistSubmissionSchema.parse(data);
}

export function safeValidateSpecialistSubmission(data: unknown) {
  return SpecialistSubmissionSchema.safeParse(data);
}
