import { describe, it, expect } from "vitest";
import {
  ManifestPatchSchema,
  ManifestPatchSetSchema,
  validateManifestPatchSet,
  safeValidateManifestPatchSet,
} from "../../src/schemas/manifest-patch.js";

const validPatch = {
  artifact_id: "artifact-001",
  op: "set",
  field: "status",
  new_value: "active",
  reason: "Activate artifact after review",
};

const validPatchSet = {
  base_manifest_seq: 0,
  apply_mode: "all_or_fail",
  patches: [validPatch],
};

describe("ManifestPatchSchema", () => {
  it("accepts a valid patch", () => {
    const result = ManifestPatchSchema.safeParse(validPatch);
    expect(result.success).toBe(true);
  });

  it("accepts patch with old_value", () => {
    const result = ManifestPatchSchema.safeParse({ ...validPatch, old_value: "draft" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid op", () => {
    const result = ManifestPatchSchema.safeParse({ ...validPatch, op: "delete" });
    expect(result.success).toBe(false);
  });

  it("rejects missing artifact_id", () => {
    const { artifact_id, ...rest } = validPatch;
    const result = ManifestPatchSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("ManifestPatchSetSchema", () => {
  it("accepts a valid patch set", () => {
    const result = ManifestPatchSetSchema.safeParse(validPatchSet);
    expect(result.success).toBe(true);
  });

  it("rejects empty patches array", () => {
    const result = ManifestPatchSetSchema.safeParse({ ...validPatchSet, patches: [] });
    expect(result.success).toBe(false);
  });

  it("rejects negative base_manifest_seq", () => {
    const result = ManifestPatchSetSchema.safeParse({ ...validPatchSet, base_manifest_seq: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects wrong apply_mode", () => {
    const result = ManifestPatchSetSchema.safeParse({ ...validPatchSet, apply_mode: "best_effort" });
    expect(result.success).toBe(false);
  });

  it("validateManifestPatchSet returns parsed data", () => {
    const parsed = validateManifestPatchSet(validPatchSet);
    expect(parsed.patches).toHaveLength(1);
  });

  it("validateManifestPatchSet throws on invalid data", () => {
    expect(() => validateManifestPatchSet({})).toThrow();
  });

  it("safeValidateManifestPatchSet returns success", () => {
    const result = safeValidateManifestPatchSet(validPatchSet);
    expect(result.success).toBe(true);
  });

  it("safeValidateManifestPatchSet returns error without throwing", () => {
    const result = safeValidateManifestPatchSet({ patches: [] });
    expect(result.success).toBe(false);
  });
});
