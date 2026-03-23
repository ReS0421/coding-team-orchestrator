import { z } from "zod";

export const ManifestPatchSchema = z.object({
  artifact_id: z.string().min(1),
  op: z.enum(["set", "increment", "append"]),
  field: z.string().min(1),
  old_value: z.unknown().optional(),
  new_value: z.unknown(),
  reason: z.string().min(1),
});

export type ManifestPatch = z.infer<typeof ManifestPatchSchema>;

export const ManifestPatchSetSchema = z.object({
  base_manifest_seq: z.number().int().nonnegative(),
  apply_mode: z.literal("all_or_fail"),
  patches: z.array(ManifestPatchSchema).min(1),
});

export type ManifestPatchSet = z.infer<typeof ManifestPatchSetSchema>;

export function validateManifestPatchSet(data: unknown): ManifestPatchSet {
  return ManifestPatchSetSchema.parse(data);
}

export function safeValidateManifestPatchSet(data: unknown) {
  return ManifestPatchSetSchema.safeParse(data);
}
