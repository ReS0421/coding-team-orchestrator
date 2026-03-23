import { describe, it, expect } from "vitest";
import type {
  ManifestArtifact,
  TransitionLogEntry,
  CheckpointEntry,
  ProjectManifest,
  ArtifactFile,
} from "../../src/store/types.js";
import { ArtifactFamily, Freshness, Lifecycle, ChangeClass, ControlState, SubmissionState } from "../../src/domain/types.js";

describe("store/types", () => {
  it("ManifestArtifact accepts valid reference artifact", () => {
    const a: ManifestArtifact = {
      id: "spec-auth",
      family: ArtifactFamily.REFERENCE,
      path: "spec.md",
      content_rev: 4,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
      depends_on: ["architecture"],
    };
    expect(a.id).toBe("spec-auth");
    expect(a.family).toBe("reference");
    expect(a.content_rev).toBe(4);
  });

  it("ManifestArtifact accepts valid control artifact", () => {
    const a: ManifestArtifact = {
      id: "exec-contract",
      family: ArtifactFamily.CONTROL,
      path: "execution-contract.md",
      content_rev: 1,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
      control_state: ControlState.ACTIVE,
      depends_on: ["tasks"],
    };
    expect(a.control_state).toBe("active");
  });

  it("ManifestArtifact accepts valid submission artifact", () => {
    const a: ManifestArtifact = {
      id: "changeset-s1-001",
      family: ArtifactFamily.SUBMISSION,
      path: "changesets/s1-001.md",
      content_rev: 1,
      submission_state: SubmissionState.ACCEPTED,
      submitted_by: "specialist-1",
    };
    expect(a.submission_state).toBe("accepted");
    expect(a.submitted_by).toBe("specialist-1");
  });

  it("ManifestArtifact works with minimal required fields", () => {
    const a: ManifestArtifact = {
      id: "minimal",
      family: ArtifactFamily.REFERENCE,
      path: "minimal.md",
      content_rev: 0,
    };
    expect(a.lifecycle).toBeUndefined();
    expect(a.freshness).toBeUndefined();
  });

  it("TransitionLogEntry has correct structure", () => {
    const t: TransitionLogEntry = {
      artifact_id: "spec-auth",
      from_content_rev: 3,
      to_content_rev: 4,
      manifest_seq_at: 5,
      change_class: ChangeClass.BEHAVIORAL,
      reason: "OAuth refresh token semantics changed",
      timestamp: "2026-03-21T14:00:00Z",
      invalidated: [
        { artifact_id: "tasks", freshness_change: "fresh → stale-soft" },
      ],
    };
    expect(t.change_class).toBe("behavioral");
    expect(t.invalidated).toHaveLength(1);
  });

  it("TransitionLogEntry works without invalidated", () => {
    const t: TransitionLogEntry = {
      artifact_id: "spec",
      from_content_rev: 0,
      to_content_rev: 1,
      manifest_seq_at: 1,
      change_class: ChangeClass.COSMETIC,
      reason: "typo fix",
      timestamp: "2026-03-21T14:00:00Z",
    };
    expect(t.invalidated).toBeUndefined();
  });

  it("CheckpointEntry has correct structure", () => {
    const cp: CheckpointEntry = {
      checkpoint_id: "cp-3",
      manifest_seq: 3,
      timestamp: "2026-03-21T15:00:00Z",
      artifacts_snapshot: [
        {
          id: "spec",
          family: ArtifactFamily.REFERENCE,
          path: "spec.md",
          content_rev: 2,
          lifecycle: Lifecycle.APPROVED,
          freshness: Freshness.FRESH,
        },
      ],
    };
    expect(cp.checkpoint_id).toBe("cp-3");
    expect(cp.artifacts_snapshot).toHaveLength(1);
  });

  it("ProjectManifest has correct structure", () => {
    const m: ProjectManifest = {
      project: "laplace-auth",
      manifest_seq: 5,
      artifacts: [],
      transitions: [],
      checkpoints: [],
    };
    expect(m.project).toBe("laplace-auth");
    expect(m.manifest_seq).toBe(5);
  });

  it("ArtifactFile has correct structure", () => {
    const f: ArtifactFile = {
      frontmatter: { title: "Spec", version: 1 },
      body: "# Spec content",
      raw: "---\ntitle: Spec\nversion: 1\n---\n# Spec content",
    };
    expect(f.frontmatter["title"]).toBe("Spec");
    expect(f.body).toContain("Spec content");
  });
});
