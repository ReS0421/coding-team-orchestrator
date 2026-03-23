import { z } from "zod";

export const PlannerReturnSchema = z.object({
  tasks_md: z.string().min(1),
  brief_md: z.string().optional(),
  tier_recommendation: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export type PlannerReturn = z.infer<typeof PlannerReturnSchema>;

export function validatePlannerReturn(data: unknown): PlannerReturn {
  return PlannerReturnSchema.parse(data);
}

export function safeValidatePlannerReturn(data: unknown) {
  return PlannerReturnSchema.safeParse(data);
}
