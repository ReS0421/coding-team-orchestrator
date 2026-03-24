import { z } from "zod";

export const SharedSurfaceEntrySchema = z.object({
  path: z.string().min(1),
  rule: z.string().min(1),
  owner: z.string().min(1),
  controllable: z.boolean().optional(), // default true — tier-judge와 정합
});

export const TimeoutProfileSchema = z.object({
  class: z.enum(["quick", "standard", "extended", "unlimited"]),
  heartbeat_required: z.boolean(),
});

export const ReturnFormatSchema = z.object({
  schema: z.string().min(1),
});

export const DispatchCardSchema = z.object({
  version: z.literal(1),
  dispatch_rev: z.number().int().positive(),
  role: z.enum(["planner", "specialist", "execution_lead", "shared_owner", "reviewer"]),
  id: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  task: z.string().min(1),
  input_refs: z.array(z.string()),
  entrypoint: z.array(z.string()),
  must_read: z.array(z.string()),
  authoritative_artifact: z.array(z.string()),
  write_scope: z.array(z.string()),
  forbidden_paths: z.array(z.string()).optional(),
  shared_surface: z.array(SharedSurfaceEntrySchema).optional(),
  completion_check: z.array(z.string()),
  return_format: ReturnFormatSchema,
  timeout_profile: TimeoutProfileSchema,
  // Sprint 3: shared protocol fields
  priority_task: z.string().optional(),       // shared owner: "shared interface 선행 수정" 지시
  selective_hold: z.boolean().optional(),     // consumer: "non-shared 작업 선행" 지시
  spawn_order: z.number().int().optional(),   // owner=1, consumer=2
  is_acting_lead: z.boolean().optional(),     // specialist 겸임 acting lead
  is_shared_owner: z.boolean().optional(),    // Tier 2: specialist가 shared owner 겸임 (Tier 3은 role: "shared_owner")
});

export type DispatchCard = z.infer<typeof DispatchCardSchema>;

export function validateDispatchCard(data: unknown): DispatchCard {
  return DispatchCardSchema.parse(data);
}

export function safeValidateDispatchCard(data: unknown) {
  return DispatchCardSchema.safeParse(data);
}
