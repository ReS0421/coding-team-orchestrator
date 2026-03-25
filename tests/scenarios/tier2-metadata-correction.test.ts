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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-meta-correction-"));
});

function makeConfig(runner: RunnerFn, overrides?: Partial<Tier2Config>): Tier2Config {
  return { projectRoot: tmpDir, logDir: path.join(tmpDir, "logs"), runner, ...overrides };
}

function makeBrief(): Brief {
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
  };
}

function seedManifest() {
  let m = createEmptyManifest("scenario");
  m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
  m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 1, freshness: Freshness.FRESH });
  saveManifest(tmpDir, m);
}

describe("tier2-metadata-correction scenarios", () => {
  it("correction → rollback → re-commit → reviewer PASS (full flow)", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" }) as RunnerFn;

    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(true);
    expect(result.correction_count).toBe(1);

    const saved = loadManifest(tmpDir);
    // All checkpoints should exist
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();

    // Rollback transition should exist
    const rollbackTransition = saved.transitions.find((t) => t.artifact_id === "_rollback");
    expect(rollbackTransition).toBeDefined();
    expect(rollbackTransition!.reason).toContain("correction rollback");

    // manifest_seq should be monotonically increasing
    expect(saved.manifest_seq).toBeGreaterThan(0);
    expect(result.final_manifest_seq).toBe(saved.manifest_seq);
  });

  it("correction 2x → escalation", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" }) as RunnerFn;

    const result = await runTier2(
      makeConfig(runner, { maxCorrections: 2 }),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("escalation");
    // After 2 corrections max, should escalate
    expect(result.correction_count).toBeGreaterThanOrEqual(1);

    const saved = loadManifest(tmpDir);
    // Should have rollback transition from escalation
    const rollbackTransitions = saved.transitions.filter((t) => t.artifact_id === "_rollback");
    expect(rollbackTransitions.length).toBeGreaterThan(0);
  });
});
