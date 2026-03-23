import { describe, it, expect } from "vitest";
import {
  createCheckpoint,
  restoreFromCheckpoint,
  listCheckpoints,
  getLatestCheckpoint,
} from "../../src/store/checkpoint.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";
import { ArtifactFamily, Lifecycle, Freshness } from "../../src/domain/types.js";

function makeManifest() {
  let m = createEmptyManifest("cp-test");
  m = addArtifact(m, {
    id: "spec",
    family: ArtifactFamily.REFERENCE,
    path: "spec.md",
    content_rev: 3,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
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

describe("createCheckpoint", () => {
  it("creates checkpoint with artifact snapshot", () => {
    const m = makeManifest();
    const result = createCheckpoint(m, "2026-03-21T15:00:00Z");
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].checkpoint_id).toBe("cp-1");
    expect(result.checkpoints[0].manifest_seq).toBe(1);
    expect(result.checkpoints[0].artifacts_snapshot).toHaveLength(2);
    expect(result.manifest_seq).toBe(1);
  });

  it("does not modify original manifest", () => {
    const m = makeManifest();
    createCheckpoint(m, "2026-03-21T15:00:00Z");
    expect(m.checkpoints).toHaveLength(0);
    expect(m.manifest_seq).toBe(0);
  });

  it("snapshots are independent copies", () => {
    const m = makeManifest();
    const withCp = createCheckpoint(m, "2026-03-21T15:00:00Z");
    const snapshot = withCp.checkpoints[0].artifacts_snapshot;
    snapshot[0].content_rev = 999;
    expect(withCp.artifacts[0].content_rev).toBe(3); // not affected
  });
});

describe("restoreFromCheckpoint", () => {
  it("restores artifacts from checkpoint", () => {
    const m = makeManifest();
    const withCp = createCheckpoint(m, "2026-03-21T15:00:00Z");
    // Simulate changes after checkpoint
    const changed = {
      ...withCp,
      manifest_seq: 5,
      artifacts: withCp.artifacts.map((a) =>
        a.id === "spec" ? { ...a, content_rev: 10, freshness: Freshness.STALE_HARD } : a,
      ),
    };
    const restored = restoreFromCheckpoint(
      changed, "cp-1", "rollback test", "2026-03-21T16:00:00Z",
    );
    expect(restored.artifacts[0].content_rev).toBe(3); // restored
    expect(restored.artifacts[0].freshness).toBe("fresh");
    expect(restored.manifest_seq).toBe(6);
  });

  it("adds rollback transition", () => {
    const m = makeManifest();
    const withCp = createCheckpoint(m, "2026-03-21T15:00:00Z");
    const restored = restoreFromCheckpoint(
      withCp, "cp-1", "test reason", "2026-03-21T16:00:00Z",
    );
    expect(restored.transitions).toHaveLength(1);
    expect(restored.transitions[0].artifact_id).toBe("_rollback");
    expect(restored.transitions[0].reason).toContain("cp-1");
  });

  it("throws for missing checkpoint", () => {
    const m = makeManifest();
    expect(() => restoreFromCheckpoint(m, "cp-999", "test")).toThrow("not found");
  });
});

describe("listCheckpoints", () => {
  it("returns empty array when no checkpoints", () => {
    const m = makeManifest();
    expect(listCheckpoints(m)).toEqual([]);
  });

  it("returns all checkpoints", () => {
    const m = makeManifest();
    const cp1 = createCheckpoint(m, "2026-03-21T15:00:00Z");
    const cp2 = createCheckpoint(cp1, "2026-03-21T16:00:00Z");
    expect(listCheckpoints(cp2)).toHaveLength(2);
  });
});

describe("getLatestCheckpoint", () => {
  it("returns undefined when no checkpoints", () => {
    const m = makeManifest();
    expect(getLatestCheckpoint(m)).toBeUndefined();
  });

  it("returns the latest checkpoint", () => {
    const m = makeManifest();
    const cp1 = createCheckpoint(m, "2026-03-21T15:00:00Z");
    const cp2 = createCheckpoint(cp1, "2026-03-21T16:00:00Z");
    expect(getLatestCheckpoint(cp2)!.checkpoint_id).toBe("cp-2");
  });
});
