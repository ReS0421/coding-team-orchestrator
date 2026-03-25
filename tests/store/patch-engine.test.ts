import { describe, it, expect } from "vitest";
import { applyPatchSet } from "../../src/store/patch-engine.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";
import { ArtifactFamily, Freshness, Lifecycle } from "../../src/domain/types.js";
import type { ManifestPatchSet } from "../../src/schemas/manifest-patch.js";

function makeManifest() {
  let m = createEmptyManifest("patch-test");
  m = addArtifact(m, {
    id: "spec",
    family: ArtifactFamily.REFERENCE,
    path: "spec.md",
    content_rev: 3,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
    depends_on: ["architecture"],
  });
  m = addArtifact(m, {
    id: "tasks",
    family: ArtifactFamily.REFERENCE,
    path: "tasks.md",
    content_rev: 1,
    lifecycle: Lifecycle.DRAFT,
    freshness: Freshness.FRESH,
  });
  return m;
}

describe("applyPatchSet", () => {
  it("applies set operation successfully", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          old_value: "fresh",
          new_value: "stale_soft",
          reason: "dependency changed",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
    expect(result.manifest.artifacts[0].freshness).toBe("stale_soft");
    expect(result.manifest.manifest_seq).toBe(1);
  });

  it("applies increment operation", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "increment",
          field: "content_rev",
          old_value: 3,
          new_value: 1,
          reason: "revision bump",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
    expect(result.manifest.artifacts[0].content_rev).toBe(4);
  });

  it("applies append operation", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "append",
          field: "depends_on",
          new_value: "new-dep",
          reason: "new dependency",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
    expect(result.manifest.artifacts[0].depends_on).toEqual([
      "architecture",
      "new-dep",
    ]);
  });

  it("rejects on manifest_seq mismatch (optimistic concurrency)", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 5, // wrong
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          new_value: "stale_soft",
          reason: "test",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("seq mismatch");
    expect(result.manifest).toBe(m); // unchanged
  });

  it("rejects on old_value mismatch", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          old_value: "stale_hard", // wrong
          new_value: "stale_soft",
          reason: "test",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("old_value");
  });

  it("all_or_fail: rolls back all patches if one fails", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          old_value: "fresh",
          new_value: "stale_soft",
          reason: "valid patch",
        },
        {
          artifact_id: "spec",
          op: "set",
          field: "lifecycle",
          old_value: "draft", // wrong — it's approved
          new_value: "proposed",
          reason: "invalid patch",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    // Original manifest unchanged
    expect(result.manifest.artifacts[0].freshness).toBe("fresh");
  });

  it("applies multiple patches in sequence", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          old_value: "fresh",
          new_value: "stale_soft",
          reason: "first patch",
        },
        {
          artifact_id: "tasks",
          op: "increment",
          field: "content_rev",
          old_value: 1,
          new_value: 1,
          reason: "bump tasks rev",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
    expect(result.manifest.artifacts[0].freshness).toBe("stale_soft");
    expect(result.manifest.artifacts[1].content_rev).toBe(2);
  });

  it("rejects patch for missing artifact", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "nonexistent",
          op: "set",
          field: "freshness",
          new_value: "stale_soft",
          reason: "test",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("not found");
  });

  // ── Task 4.1: increment type-check order ──
  it("rejects increment with string currentValue", () => {
    let m = createEmptyManifest("inc-test");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    // Manually set a string field to test type guard
    (m.artifacts[0] as unknown as Record<string, unknown>)["lifecycle"] = "draft";
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{ artifact_id: "a", op: "increment", field: "lifecycle", new_value: 1, reason: "test" }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("expected number for increment");
  });

  it("rejects increment with string new_value", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{ artifact_id: "spec", op: "increment", field: "content_rev", new_value: "one" as unknown as number, reason: "test" }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Increment new_value must be number");
  });

  it("increment with undefined currentValue starts from 0", () => {
    let m = createEmptyManifest("inc-undef");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{ artifact_id: "a", op: "increment", field: "submitted_by" as string, new_value: 5, reason: "test" }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
    expect((result.manifest.artifacts[0] as unknown as Record<string, unknown>)["submitted_by"]).toBe(5);
  });

  // ── Task 4.3: deepEqual key-order independent ──
  it("old_value check is key-order independent for objects", () => {
    let m = createEmptyManifest("deep-eq");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    // Set a nested object field
    (m.artifacts[0] as unknown as Record<string, unknown>)["meta"] = { b: 2, a: 1 };
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "a", op: "set", field: "meta",
        old_value: { a: 1, b: 2 }, // different key order
        new_value: { c: 3 }, reason: "test",
      }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
  });

  it("deepEqual handles nested objects and arrays", () => {
    let m = createEmptyManifest("deep-eq2");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    (m.artifacts[0] as unknown as Record<string, unknown>)["meta"] = { nested: { b: [1, 2], a: "x" } };
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "a", op: "set", field: "meta",
        old_value: { nested: { a: "x", b: [1, 2] } },
        new_value: "replaced", reason: "test",
      }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
  });

  it("deepEqual rejects different types", () => {
    let m = createEmptyManifest("deep-eq3");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "a", op: "set", field: "content_rev",
        old_value: "1", // string vs number
        new_value: 2, reason: "test",
      }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("old_value");
  });

  it("deepEqual handles null comparison", () => {
    let m = createEmptyManifest("deep-eq4");
    m = addArtifact(m, {
      id: "a", family: ArtifactFamily.REFERENCE, path: "a.md", content_rev: 1,
    });
    (m.artifacts[0] as unknown as Record<string, unknown>)["meta"] = null;
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0, apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "a", op: "set", field: "meta",
        old_value: null,
        new_value: "set", reason: "test",
      }],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(true);
  });

  it("does not modify original manifest on success", () => {
    const m = makeManifest();
    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          new_value: "stale_soft",
          reason: "test",
        },
      ],
    };
    applyPatchSet(m, patchSet);
    expect(m.artifacts[0].freshness).toBe("fresh");
    expect(m.manifest_seq).toBe(0);
  });
});
