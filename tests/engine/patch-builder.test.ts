import { describe, it, expect } from "vitest";
import { buildPatchSetFromSubmission, buildCombinedPatchSet } from "../../src/engine/patch-builder.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";

function makeManifest() {
  let m = createEmptyManifest("pb-test");
  m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
  m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 2, freshness: Freshness.FRESH });
  m = addArtifact(m, { id: "api", family: ArtifactFamily.REFERENCE, path: "src/api.ts", content_rev: 1, freshness: Freshness.FRESH });
  return m;
}

function makeSub(files: string[]): SpecialistSubmission {
  return {
    status: "done",
    touched_files: files,
    changeset: "diff",
    delta_stub: "stub",
    evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
  };
}

describe("buildPatchSetFromSubmission", () => {
  it("auto-matches exact path", () => {
    const m = makeManifest();
    const result = buildPatchSetFromSubmission(makeSub(["spec.md"]), m);
    expect(result).not.toBeNull();
    expect(result!.patches).toHaveLength(1);
    expect(result!.patches[0].artifact_id).toBe("spec");
    expect(result!.patches[0].op).toBe("increment");
    expect(result!.patches[0].field).toBe("content_rev");
  });

  it("explicit mapping overrides auto-match", () => {
    const m = makeManifest();
    const result = buildPatchSetFromSubmission(
      makeSub(["output.txt"]),
      m,
      { "output.txt": "spec" },
    );
    expect(result).not.toBeNull();
    expect(result!.patches[0].artifact_id).toBe("spec");
  });

  it("auto-matches by prefix", () => {
    const m = makeManifest();
    const result = buildPatchSetFromSubmission(makeSub(["src/api.test.ts"]), m);
    expect(result).not.toBeNull();
    expect(result!.patches[0].artifact_id).toBe("api");
  });

  it("skips unknown files", () => {
    const m = makeManifest();
    const result = buildPatchSetFromSubmission(makeSub(["unknown.xyz"]), m);
    expect(result).toBeNull();
  });

  it("returns null for empty touched_files", () => {
    const m = makeManifest();
    const result = buildPatchSetFromSubmission(makeSub([]), m);
    expect(result).toBeNull();
  });
});

describe("buildCombinedPatchSet", () => {
  it("combines 2 specialists", () => {
    const m = makeManifest();
    const sub1 = makeSub(["spec.md"]);
    const sub2 = makeSub(["tasks.md"]);
    const result = buildCombinedPatchSet([sub1, sub2], m);
    expect(result).not.toBeNull();
    expect(result!.patches).toHaveLength(2);
    const ids = result!.patches.map((p) => p.artifact_id).sort();
    expect(ids).toEqual(["spec", "tasks"]);
  });

  it("deduplicates same artifact from 2 specialists", () => {
    const m = makeManifest();
    const sub1 = makeSub(["spec.md"]);
    const sub2 = makeSub(["spec.md"]);
    const result = buildCombinedPatchSet([sub1, sub2], m);
    expect(result).not.toBeNull();
    expect(result!.patches).toHaveLength(1);
  });

  it("returns null for empty submissions", () => {
    const m = makeManifest();
    const result = buildCombinedPatchSet([], m);
    expect(result).toBeNull();
  });
});
