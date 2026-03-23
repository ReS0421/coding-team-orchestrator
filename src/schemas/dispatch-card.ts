import { z } from "zod";

export const SharedSurfaceEntrySchema = z.object({
  path: z.string().min(1),
  rule: z.string().min(1),
  owner: z.string().min(1),
});

export const TimeoutProfileSchema = z.object({
  class: z.enum(["short", "medium", "long", "infinite"]),
  heartbeat_required: z.boolean(),
});

export const ReturnFormatSchema = z.object({
  schema: z.string().min(1),
});

export const DispatchCardSchema = z.object({
  version: z.literal(1),
  dispatch_rev: z.string().min(1),
  role: z.enum(["planner", "specialist", "reviewer", "lead", "observer"]),
  id: z.string().min(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  task: z.string().min(1),
  input_refs: z.array(z.string()),
  entrypoint: z.string().min(1),
  must_read: z.array(z.string()),
  authoritative_artifact: z.string().min(1),
  write_scope: z.array(z.string()),
  forbidden_paths: z.array(z.string()).optional(),
  shared_surface: z.array(SharedSurfaceEntrySchema).optional(),
  completion_check: z.string().min(1),
  return_format: ReturnFormatSchema,
  timeout_profile: TimeoutProfileSchema,
});

export type DispatchCard = z.infer<typeof DispatchCardSchema>;

export function validateDispatchCard(data: unknown): DispatchCard {
  return DispatchCardSchema.parse(data);
}

export function safeValidateDispatchCard(data: unknown) {
  return DispatchCardSchema.safeParse(data);
}
