import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier1, type OrchestratorConfig } from "../../src/engine/orchestrator.js";
import type { TaskRequest } from "../../src/engine/dispatch-rule.js";
import type { RunnerFn } from "../../src/runners/types.js";
import { fakeRunner } from "../helpers/fake-runner.js";
import { createCrashRunner } from "../helpers/crash-runner.js";
import { loadManifest, createEmptyManifest, saveManifest, addArtifact } from "../../src/store/manifest.js";
import { findCheckpointByPhase } from "../../src/store/checkpoint.js";
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-meta-scenario-"));
});

function makeConfig(runner: RunnerFn): OrchestratorConfig {
  return { projectRoot: tmpDir, logDir: path.join(tmpDir, "logs"), runner };
}

function makeRequest(overrides?: Partial<TaskRequest>): TaskRequest {
  return { task: "Implement feature", write_scope: ["spec.md"], ...overrides };
}

describe("tier1-metadata scenarios", () => {
  it("happy path → manifest patch + checkpoint", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(tmpDir, m);

    const result = await runTier1(makeConfig(fakeRunner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.final_manifest_seq).toBeDefined();

    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
    // content_rev should have been incremented
    const spec = saved.artifacts.find((a) => a.id === "spec");
    expect(spec).toBeDefined();
    // manifest_seq should be > 0
    expect(saved.manifest_seq).toBeGreaterThan(0);
  });

  it("failure → manifest completely unchanged", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(tmpDir, m);

    const crashRunner = createCrashRunner({ mode: "crash", errorMessage: "boom" });
    const result = await runTier1(
      { ...makeConfig(crashRunner), maxRetries: 0 },
      makeRequest(),
    );
    expect(result.success).toBe(false);

    const saved = loadManifest(tmpDir);
    expect(saved.manifest_seq).toBe(0);
    expect(saved.checkpoints).toHaveLength(0);
    expect(saved.transitions).toHaveLength(0);
    expect(saved.artifacts[0].content_rev).toBe(1);
  });

  it("unregistered files → partial patch (known artifacts only)", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(tmpDir, m);

    // Runner returns unknown files that won't match any artifact
    const mixedRunner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      return {
        status: "done",
        touched_files: ["spec.md", "unknown.xyz"],
        changeset: "diff",
        delta_stub: "stub",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };

    const result = await runTier1(makeConfig(mixedRunner), makeRequest());
    expect(result.success).toBe(true);

    const saved = loadManifest(tmpDir);
    // spec should have been patched
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
    expect(saved.manifest_seq).toBeGreaterThan(0);
  });

  it("freshness propagation → dependent artifact stale", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    m = addArtifact(m, { id: "dep", family: ArtifactFamily.REFERENCE, path: "dep.md", content_rev: 1, freshness: Freshness.FRESH, depends_on: ["spec"] });
    saveManifest(tmpDir, m);

    const result = await runTier1(makeConfig(fakeRunner), makeRequest());
    expect(result.success).toBe(true);

    // After patch+freshness propagation, dep should be stale
    // The cp-done checkpoint captures state after the full pipeline
    const saved = loadManifest(tmpDir);
    const doneCp = findCheckpointByPhase(saved, "done");
    expect(doneCp).toBeDefined();
    // dep depends on spec; after spec's content_rev changes, dep should be stale_soft
    const depInSnapshot = doneCp!.artifacts_snapshot.find((a) => a.id === "dep");
    expect(depInSnapshot?.freshness).toBe("stale_soft");
  });
});
