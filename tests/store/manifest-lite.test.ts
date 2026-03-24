import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createEmptyManifestLite,
  loadManifestLite,
  saveManifestLite,
  addManifestLiteArtifact,
  upgradeToFullManifest,
} from "../../src/store/manifest-lite.js";
import type { ManifestLiteArtifact } from "../../src/store/types.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, "tmp-"));
  return () => fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleArtifact: ManifestLiteArtifact = {
  id: "tasks_md",
  family: "reference",
  path: "artifacts/tasks.md",
  content_rev: 1,
  lifecycle: "approved",
  freshness: "fresh",
};

describe("createEmptyManifestLite", () => {
  it("creates with seq 0 and empty artifacts", () => {
    const lite = createEmptyManifestLite("brief-auth");
    expect(lite.manifest_lite_seq).toBe(0);
    expect(lite.brief_id).toBe("brief-auth");
    expect(lite.artifacts).toEqual([]);
    expect(lite.bootstrap_from).toBeUndefined();
  });
});

describe("save/load round-trip", () => {
  it("preserves data through save and load", () => {
    const original = createEmptyManifestLite("brief-test");
    const withArtifact = addManifestLiteArtifact(original, sampleArtifact);
    saveManifestLite(tmpDir, withArtifact);
    const loaded = loadManifestLite(tmpDir);
    expect(loaded.manifest_lite_seq).toBe(1);
    expect(loaded.brief_id).toBe("brief-test");
    expect(loaded.artifacts).toHaveLength(1);
    expect(loaded.artifacts[0].id).toBe("tasks_md");
    expect(loaded.artifacts[0].lifecycle).toBe("approved");
  });
});

describe("addManifestLiteArtifact", () => {
  it("increments seq and appends artifact", () => {
    const lite = createEmptyManifestLite("brief-1");
    const updated = addManifestLiteArtifact(lite, sampleArtifact);
    expect(updated.manifest_lite_seq).toBe(1);
    expect(updated.artifacts).toHaveLength(1);

    const updated2 = addManifestLiteArtifact(updated, {
      ...sampleArtifact,
      id: "brief_md",
      content_rev: 2,
    });
    expect(updated2.manifest_lite_seq).toBe(2);
    expect(updated2.artifacts).toHaveLength(2);
  });

  it("does not mutate original", () => {
    const lite = createEmptyManifestLite("brief-1");
    addManifestLiteArtifact(lite, sampleArtifact);
    expect(lite.manifest_lite_seq).toBe(0);
    expect(lite.artifacts).toHaveLength(0);
  });
});

describe("upgradeToFullManifest", () => {
  it("converts to ProjectManifest with empty transitions/checkpoints", () => {
    let lite = createEmptyManifestLite("brief-upgrade");
    lite = addManifestLiteArtifact(lite, sampleArtifact);

    const full = upgradeToFullManifest(lite);
    expect(full.project).toBe("brief-upgrade");
    expect(full.manifest_seq).toBe(1);
    expect(full.artifacts).toHaveLength(1);
    expect(full.artifacts[0].id).toBe("tasks_md");
    expect(full.transitions).toEqual([]);
    expect(full.checkpoints).toEqual([]);
  });

  it("converts empty manifest-lite to empty full manifest", () => {
    const lite = createEmptyManifestLite("brief-empty");
    const full = upgradeToFullManifest(lite);
    expect(full.manifest_seq).toBe(0);
    expect(full.artifacts).toEqual([]);
  });
});
