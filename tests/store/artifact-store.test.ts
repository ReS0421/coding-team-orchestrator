import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readArtifact,
  writeArtifact,
  artifactExists,
  deleteArtifact,
} from "../../src/store/artifact-store.js";

describe("parseFrontmatter", () => {
  it("parses frontmatter and body", () => {
    const raw = "---\ntitle: Spec\nversion: 1\n---\n# Content here";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Spec", version: 1 });
    expect(result.body).toBe("# Content here");
    expect(result.raw).toBe(raw);
  });

  it("handles file without frontmatter", () => {
    const raw = "# Just a markdown file";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("handles empty frontmatter", () => {
    const raw = "---\n\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body");
  });

  it("handles complex YAML frontmatter", () => {
    const raw = "---\ntags:\n  - a\n  - b\nnested:\n  key: val\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter["tags"]).toEqual(["a", "b"]);
    expect((result.frontmatter["nested"] as Record<string, string>)["key"]).toBe("val");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes frontmatter + body", () => {
    const result = serializeFrontmatter({ title: "Test" }, "# Body\n");
    expect(result).toContain("---");
    expect(result).toContain("title: Test");
    expect(result).toContain("# Body\n");
  });

  it("roundtrips with parseFrontmatter", () => {
    const fm = { title: "Roundtrip", version: 3 };
    const body = "Content here\n";
    const serialized = serializeFrontmatter(fm, body);
    const parsed = parseFrontmatter(serialized);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body).toBe(body);
  });
});

describe("artifact file CRUD", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-store-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeArtifact + readArtifact roundtrip", () => {
    writeArtifact(tmpDir, "spec.md", { title: "Spec", rev: 1 }, "# Spec\n");
    const result = readArtifact(tmpDir, "spec.md");
    expect(result.frontmatter["title"]).toBe("Spec");
    expect(result.frontmatter["rev"]).toBe(1);
    expect(result.body).toBe("# Spec\n");
  });

  it("writeArtifact creates nested directories", () => {
    writeArtifact(tmpDir, "deep/nested/dir/artifact.md", { id: "deep" }, "body");
    expect(artifactExists(tmpDir, "deep/nested/dir/artifact.md")).toBe(true);
  });

  it("artifactExists returns false for missing files", () => {
    expect(artifactExists(tmpDir, "nonexistent.md")).toBe(false);
  });

  it("deleteArtifact removes the file", () => {
    writeArtifact(tmpDir, "to-delete.md", { del: true }, "");
    expect(artifactExists(tmpDir, "to-delete.md")).toBe(true);
    deleteArtifact(tmpDir, "to-delete.md");
    expect(artifactExists(tmpDir, "to-delete.md")).toBe(false);
  });

  it("readArtifact throws for missing file", () => {
    expect(() => readArtifact(tmpDir, "nope.md")).toThrow();
  });

  it("writeArtifact overwrites existing file", () => {
    writeArtifact(tmpDir, "overwrite.md", { v: 1 }, "old");
    writeArtifact(tmpDir, "overwrite.md", { v: 2 }, "new");
    const result = readArtifact(tmpDir, "overwrite.md");
    expect(result.frontmatter["v"]).toBe(2);
    expect(result.body).toBe("new");
  });
});

import { saveBrief, loadBrief } from "../../src/store/artifact-store.js";

describe("Brief thin wrapper", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brief-store-"));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("round-trips a brief (save → load)", () => {
    const brief = {
      brief_id: "test-brief",
      goal: "Test goal",
      out_of_scope: ["DB changes"],
      specialists: [
        { id: "s-1", scope: ["src/a/"], owns: ["src/a/file.ts"] },
        { id: "s-2", scope: ["src/b/"], owns: [] },
      ],
      shared: ["src/shared.ts"],
      accept_checks: ["build passes"],
      escalate_if: ["shared files 3+"],
    };
    saveBrief(projectRoot, brief);
    const loaded = loadBrief(projectRoot);
    expect(loaded.brief_id).toBe(brief.brief_id);
    expect(loaded.goal).toBe(brief.goal);
    expect(loaded.specialists).toHaveLength(2);
    expect(loaded.specialists[0].id).toBe("s-1");
    expect(loaded.shared).toEqual(["src/shared.ts"]);
    expect(loaded.accept_checks).toEqual(["build passes"]);
  });

  it("round-trips a brief with empty shared", () => {
    const brief = {
      brief_id: "no-shared",
      goal: "No shared test",
      out_of_scope: [],
      specialists: [
        { id: "s-1", scope: ["src/"], owns: [] },
      ],
      shared: [],
      accept_checks: ["tests pass"],
      escalate_if: [],
    };
    saveBrief(projectRoot, brief);
    const loaded = loadBrief(projectRoot);
    expect(loaded.shared).toEqual([]);
    expect(loaded.escalate_if).toEqual([]);
  });

  describe("CRLF normalization", () => {
    it("parses CRLF frontmatter correctly", () => {
      const raw = "---\r\ntitle: hello\r\n---\r\nbody text";
      const result = parseFrontmatter(raw);
      expect(result.frontmatter).toEqual({ title: "hello" });
      expect(result.body).toBe("body text");
      expect(result.raw).toBe(raw); // raw preserves original
    });

    it("strips \\r from body", () => {
      const raw = "---\r\nk: v\r\n---\r\nline1\r\nline2";
      const result = parseFrontmatter(raw);
      expect(result.body).toBe("line1\nline2");
      expect(result.body).not.toContain("\r");
    });

    it("handles mixed \\r\\n and \\n", () => {
      const raw = "---\r\nk: v\n---\nsome body\r\nmore";
      const result = parseFrontmatter(raw);
      expect(result.frontmatter).toEqual({ k: "v" });
      expect(result.body).toBe("some body\nmore");
    });
  });

});
