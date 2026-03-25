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
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";

let tmpDir: string;
let projectRoot: string;
let logDir: string;

function makeConfig(runner: RunnerFn, maxRetries?: number): OrchestratorConfig {
  return { projectRoot, logDir, runner, maxRetries };
}

function makeRequest(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    task: "Implement feature",
    write_scope: ["spec.md"],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-manifest-"));
  projectRoot = tmpDir;
  logDir = path.join(tmpDir, "logs");
});

describe("runTier1 manifest integration", () => {
  it("success → cp-done checkpoint exists", async () => {
    // Pre-seed manifest with artifact matching write_scope
    let m = createEmptyManifest("t1-test");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(projectRoot, m);

    const result = await runTier1(makeConfig(fakeRunner), makeRequest());
    expect(result.success).toBe(true);

    const saved = loadManifest(projectRoot);
    const cpDone = saved.checkpoints.find((c) => c.checkpoint_id.startsWith("cp-done-"));
    expect(cpDone).toBeDefined();
  });

  it("success → manifest_seq increased", async () => {
    let m = createEmptyManifest("t1-test");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(projectRoot, m);

    const result = await runTier1(makeConfig(fakeRunner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.final_manifest_seq).toBeDefined();
    expect(result.final_manifest_seq!).toBeGreaterThan(0);
  });

  it("failure → manifest unchanged", async () => {
    let m = createEmptyManifest("t1-test");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(projectRoot, m);

    const crashRunner = createCrashRunner({ mode: "crash", errorMessage: "boom" });
    const result = await runTier1(makeConfig(crashRunner, 0), makeRequest());
    expect(result.success).toBe(false);

    const saved = loadManifest(projectRoot);
    expect(saved.checkpoints).toHaveLength(0);
    expect(saved.manifest_seq).toBe(0);
  });
});
