import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier2, type Tier2Config } from "../../src/engine/orchestrator.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { RunnerFn } from "../../src/runners/types.js";
import { createStatefulRunner } from "../helpers/fake-runner.js";
import { loadManifest, createEmptyManifest, saveManifest, addArtifact } from "../../src/store/manifest.js";
import { findCheckpointByPhase } from "../../src/store/checkpoint.js";
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-meta-happy-"));
});

function makeConfig(runner: RunnerFn): Tier2Config {
  return { projectRoot: tmpDir, logDir: path.join(tmpDir, "logs"), runner };
}

function makeBrief(overrides?: Partial<Brief>): Brief {
  return {
    brief_id: "test-brief",
    goal: "Test",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["spec.md"], owns: [] },
      { id: "specialist-2", scope: ["tasks.md"], owns: [] },
    ],
    shared: [],
    accept_checks: ["build"],
    escalate_if: [],
    ...overrides,
  };
}

describe("tier2-metadata-happy scenarios", () => {
  it("shared-free happy path → cp-execution, cp-review, cp-done", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(tmpDir, m);

    const runner = createStatefulRunner() as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(true);
    expect(result.checkpoints_created).toContain("cp-execution");
    expect(result.checkpoints_created).toContain("cp-review");
    expect(result.checkpoints_created).toContain("cp-done");

    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    expect(findCheckpointByPhase(saved, "review")).toBeDefined();
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
    expect(saved.manifest_seq).toBeGreaterThan(0);
    expect(result.final_manifest_seq).toBe(saved.manifest_seq);
  });

  it("shared path + manifest state", async () => {
    let m = createEmptyManifest("scenario");
    m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
    m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 1, freshness: Freshness.FRESH });
    saveManifest(tmpDir, m);

    const runner = createStatefulRunner() as RunnerFn;
    const brief = makeBrief({
      specialists: [
        { id: "specialist-1", scope: ["spec.md"], owns: ["spec.md"] },
        { id: "specialist-2", scope: ["tasks.md"], owns: [] },
      ],
      shared: ["spec.md"],
    });

    const result = await runTier2(
      makeConfig(runner),
      {
        task: "test",
        write_scope: ["spec.md", "tasks.md"],
        brief,
        shared_surfaces: [{ path: "spec.md", rule: "tier2_shared_protocol", owner: "specialist-1" }],
      },
    );

    expect(result.success).toBe(true);
    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
    expect(saved.manifest_seq).toBeGreaterThan(0);
  });

  it("no manifest start → normal processing", async () => {
    // Don't seed manifest — orchestrator creates empty one
    const runner = createStatefulRunner() as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(true);
    expect(result.final_manifest_seq).toBeDefined();
    expect(result.checkpoints_created).toContain("cp-done");

    const saved = loadManifest(tmpDir);
    expect(saved.manifest_seq).toBeGreaterThan(0);
  });
});
