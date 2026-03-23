import { z } from "zod";

export const ReviewIssueSchema = z.object({
  issue_id: z.string().min(1),
  severity: z.enum(["critical", "major", "minor"]),
  blocking: z.boolean(),
  evidence: z.string().min(1),
  fix_owner: z.string().optional(),
  deferrable: z.boolean().optional(),
  violated_contract: z.string().optional(),
});

export const ReviewerReturnSchema = z.object({
  review_report: z.string().min(1),
  disposition: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  issues: z.array(ReviewIssueSchema),
});

export type ReviewerReturn = z.infer<typeof ReviewerReturnSchema>;

export function validateReviewerReturn(data: unknown): ReviewerReturn {
  return ReviewerReturnSchema.parse(data);
}

export function safeValidateReviewerReturn(data: unknown) {
  return ReviewerReturnSchema.safeParse(data);
}
