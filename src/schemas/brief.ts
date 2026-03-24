import { z } from "zod";

export const BriefSpecialistEntrySchema = z.object({
  id: z.string().min(1),
  scope: z.array(z.string().min(1)).min(1),
  owns: z.array(z.string().min(1)),
});

export const BriefSchema = z.object({
  brief_id: z.string().min(1),
  goal: z.string().min(1),
  out_of_scope: z.array(z.string()),
  specialists: z.array(BriefSpecialistEntrySchema).min(1),
  shared: z.array(z.string()),
  accept_checks: z.array(z.string().min(1)).min(1),
  escalate_if: z.array(z.string()),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefSpecialistEntry = z.infer<typeof BriefSpecialistEntrySchema>;

export function validateBrief(data: unknown): Brief {
  return BriefSchema.parse(data);
}

export function safeValidateBrief(data: unknown) {
  return BriefSchema.safeParse(data);
}
