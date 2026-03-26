import { z } from "zod";

export const SpecialistAssignmentSchema = z.object({
  specialist_id: z.string().min(1),
  task: z.string().min(1),
  shared_owner: z.boolean().default(false),
  priority: z.number().int().min(1).default(1),
});

export const ExecutionContractSchema = z.object({
  contract_id: z.string().min(1),
  brief_id: z.string().min(1),
  specialist_assignments: z.array(SpecialistAssignmentSchema).min(1),
  shared_surfaces: z.array(z.string()).default([]),
  active_span: z.number().int().min(1).default(3),
  implementability_notes: z.string().optional(),
});

export type SpecialistAssignment = z.infer<typeof SpecialistAssignmentSchema>;
export type ExecutionContract = z.infer<typeof ExecutionContractSchema>;

export function validateExecutionContract(data: unknown): ExecutionContract {
  return ExecutionContractSchema.parse(data);
}

export function safeValidateExecutionContract(data: unknown) {
  return ExecutionContractSchema.safeParse(data);
}
