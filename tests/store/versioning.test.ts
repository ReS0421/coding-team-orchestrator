import { describe, it, expect } from "vitest";
import {
  shouldIncrementContentRev,
  incrementContentRev,
  incrementManifestSeq,
} from "../../src/store/versioning.js";
import { ChangeClass, ArtifactFamily, Lifecycle, Freshness } from "../../src/domain/types.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";

function makeManifest() {
  let m = createEmptyManifest("ver-test");
  m = addArtifact(m, {
    id: "spec",
    family: ArtifactFamily.REFERENCE,
    path: "spec.md",
    content_rev: 3,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
  });
  return m;
}

describe("shouldIncrementContentRev", () => {
  it("returns true for structural", () => {
    expect(shouldIncrementContentRev(ChangeClass.STRUCTURAL)).toBe(true);
  });
  it("returns true for behavioral", () => {
    expect(shouldIncrementContentRev(ChangeClass.BEHAVIORAL)).toBe(true);
  });
  it("returns true for scope", () => {
    expect(shouldIncrementContentRev(ChangeClass.SCOPE)).toBe(true);
  });
  it("returns false for cosmetic", () => {
    expect(shouldIncrementContentRev(ChangeClass.COSMETIC)).toBe(false);
  });
});

describe("incrementContentRev", () => {
  it("increments content_rev and manifest_seq", () => {
    const m = makeManifest();
    const result = incrementContentRev(
      m, "spec", ChangeClass.BEHAVIORAL, "API change", "2026-03-21T14:00:00Z",
    );
    expect(result.artifacts[0].content_rev).toBe(4);
    expect(result.manifest_seq).toBe(1);
    expect(m.artifacts[0].content_rev).toBe(3); // immutable
  });

  it("adds a transition log entry", () => {
    const m = makeManifest();
    const result = incrementContentRev(
      m, "spec", ChangeClass.STRUCTURAL, "restructure", "2026-03-21T15:00:00Z",
    );
    expect(result.transitions).toHaveLength(1);
    const t = result.transitions[0];
    expect(t.artifact_id).toBe("spec");
    expect(t.from_content_rev).toBe(3);
    expect(t.to_content_rev).toBe(4);
    expect(t.change_class).toBe("structural");
  });

  it("throws for missing artifact", () => {
    const m = makeManifest();
    expect(() =>
      incrementContentRev(m, "nope", ChangeClass.BEHAVIORAL, "x"),
    ).toThrow("not found");
  });

  it("uses current timestamp when not provided", () => {
    const m = makeManifest();
    const result = incrementContentRev(m, "spec", ChangeClass.SCOPE, "scope change");
    expect(result.transitions[0].timestamp).toBeTruthy();
  });
});

describe("incrementManifestSeq", () => {
  it("increments only manifest_seq", () => {
    const m = makeManifest();
    const result = incrementManifestSeq(m);
    expect(result.manifest_seq).toBe(1);
    expect(result.artifacts[0].content_rev).toBe(3); // unchanged
    expect(m.manifest_seq).toBe(0); // immutable
  });
});
