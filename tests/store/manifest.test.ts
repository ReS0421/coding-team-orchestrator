import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEmptyManifest,
  loadManifest,
  saveManifest,
  findArtifact,
  addArtifact,
  updateArtifact,
  listArtifacts,
} from "../../src/store/manifest.js";
import type { ManifestArtifact } from "../../src/store/types.js";
import { ArtifactFamily, Lifecycle, Freshness } from "../../src/domain/types.js";

describe("manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createEmptyManifest", () => {
    it("creates manifest with seq 0 and empty arrays", () => {
      const m = createEmptyManifest("test-project");
      expect(m.project).toBe("test-project");
      expect(m.manifest_seq).toBe(0);
      expect(m.artifacts).toEqual([]);
      expect(m.transitions).toEqual([]);
      expect(m.checkpoints).toEqual([]);
    });
  });

  describe("save + load roundtrip", () => {
    it("roundtrips a manifest through YAML", () => {
      const m = createEmptyManifest("roundtrip-test");
      const withArtifact = addArtifact(m, {
        id: "spec",
        family: ArtifactFamily.REFERENCE,
        path: "spec.md",
        content_rev: 1,
        lifecycle: Lifecycle.DRAFT,
        freshness: Freshness.FRESH,
      });
      saveManifest(tmpDir, withArtifact);
      const loaded = loadManifest(tmpDir);
      expect(loaded.project).toBe("roundtrip-test");
      expect(loaded.artifacts).toHaveLength(1);
      expect(loaded.artifacts[0].id).toBe("spec");
      expect(loaded.artifacts[0].freshness).toBe("fresh");
    });

    // ── Task 4.2: loadManifest YAML null guard ──
    it("throws on empty file", () => {
      fs.writeFileSync(path.join(tmpDir, "project-manifest.yaml"), "");
      expect(() => loadManifest(tmpDir)).toThrow("Invalid manifest");
    });

    it("throws on number YAML", () => {
      fs.writeFileSync(path.join(tmpDir, "project-manifest.yaml"), "42\n");
      expect(() => loadManifest(tmpDir)).toThrow("Invalid manifest");
    });

    it("throws on string YAML", () => {
      fs.writeFileSync(path.join(tmpDir, "project-manifest.yaml"), "hello world\n");
      expect(() => loadManifest(tmpDir)).toThrow("Invalid manifest");
    });

    it("throws on null YAML", () => {
      fs.writeFileSync(path.join(tmpDir, "project-manifest.yaml"), "null\n");
      expect(() => loadManifest(tmpDir)).toThrow("Invalid manifest");
    });

    it("loads manifest with missing optional arrays", () => {
      const yamlContent = "project: minimal\nmanifest_seq: 0\n";
      fs.writeFileSync(path.join(tmpDir, "project-manifest.yaml"), yamlContent);
      const loaded = loadManifest(tmpDir);
      expect(loaded.artifacts).toEqual([]);
      expect(loaded.transitions).toEqual([]);
      expect(loaded.checkpoints).toEqual([]);
    });
  });

  describe("findArtifact", () => {
    it("finds existing artifact by id", () => {
      let m = createEmptyManifest("find-test");
      m = addArtifact(m, {
        id: "spec",
        family: ArtifactFamily.REFERENCE,
        path: "spec.md",
        content_rev: 1,
      });
      expect(findArtifact(m, "spec")).toBeDefined();
      expect(findArtifact(m, "spec")!.path).toBe("spec.md");
    });

    it("returns undefined for missing artifact", () => {
      const m = createEmptyManifest("find-test");
      expect(findArtifact(m, "nope")).toBeUndefined();
    });
  });

  describe("addArtifact", () => {
    it("adds artifact immutably", () => {
      const original = createEmptyManifest("add-test");
      const artifact: ManifestArtifact = {
        id: "new",
        family: ArtifactFamily.SUBMISSION,
        path: "new.md",
        content_rev: 1,
      };
      const updated = addArtifact(original, artifact);
      expect(original.artifacts).toHaveLength(0);
      expect(updated.artifacts).toHaveLength(1);
    });

    it("throws on duplicate id", () => {
      let m = createEmptyManifest("dup-test");
      const artifact: ManifestArtifact = {
        id: "dup",
        family: ArtifactFamily.REFERENCE,
        path: "dup.md",
        content_rev: 1,
      };
      m = addArtifact(m, artifact);
      expect(() => addArtifact(m, artifact)).toThrow("already exists");
    });
  });

  describe("updateArtifact", () => {
    it("updates artifact immutably", () => {
      let m = createEmptyManifest("update-test");
      m = addArtifact(m, {
        id: "spec",
        family: ArtifactFamily.REFERENCE,
        path: "spec.md",
        content_rev: 1,
        freshness: Freshness.FRESH,
      });
      const updated = updateArtifact(m, "spec", {
        content_rev: 2,
        freshness: Freshness.STALE_SOFT,
      });
      expect(m.artifacts[0].content_rev).toBe(1);
      expect(updated.artifacts[0].content_rev).toBe(2);
      expect(updated.artifacts[0].freshness).toBe("stale_soft");
    });

    it("throws for missing artifact", () => {
      const m = createEmptyManifest("update-test");
      expect(() => updateArtifact(m, "nope", { content_rev: 2 })).toThrow(
        "not found",
      );
    });
  });

  describe("listArtifacts", () => {
    it("lists all artifacts", () => {
      let m = createEmptyManifest("list-test");
      m = addArtifact(m, {
        id: "ref1",
        family: ArtifactFamily.REFERENCE,
        path: "r.md",
        content_rev: 1,
      });
      m = addArtifact(m, {
        id: "sub1",
        family: ArtifactFamily.SUBMISSION,
        path: "s.md",
        content_rev: 1,
      });
      expect(listArtifacts(m)).toHaveLength(2);
    });

    it("filters by family", () => {
      let m = createEmptyManifest("list-test");
      m = addArtifact(m, {
        id: "ref1",
        family: ArtifactFamily.REFERENCE,
        path: "r.md",
        content_rev: 1,
      });
      m = addArtifact(m, {
        id: "sub1",
        family: ArtifactFamily.SUBMISSION,
        path: "s.md",
        content_rev: 1,
      });
      expect(listArtifacts(m, "reference")).toHaveLength(1);
      expect(listArtifacts(m, "submission")).toHaveLength(1);
      expect(listArtifacts(m, "control")).toHaveLength(0);
    });
  });
});
