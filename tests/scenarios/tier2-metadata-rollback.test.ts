import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier2, type Tier2Config } from "../../src/engine/orchestrator.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { RunnerFn } from "../../src/runners/types.js";
import { fakeRunner, createStatefulRunner } from "../helpers/fake-runner.js";
import { loadManifest, createEmptyManifest, saveManifest, addArtifact } from "../../src/store/manifest.js";
import { findCheckpointByPhase } from "../../src/store/checkpoint.js";
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-meta-rollback-"));
});

function makeConfig(runner: RunnerFn, overrides?: Partial<Tier2Config>): Tier2Config {
  return { projectRoot: tmpDir, logDir: path.join(tmpDir, "logs"), runner, ...overrides };
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

function seedManifest() {
  let m = createEmptyManifest("scenario");
  m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
  m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 1, freshness: Freshness.FRESH });
  saveManifest(tmpDir, m);
}

describe("tier2-metadata-rollback scenarios", () => {
  it("escalation → manifest restored to execution checkpoint state", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" }) as RunnerFn;

    const result = await runTier2(
      makeConfig(runner, { maxCorrections: 1 }),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("escalation");

    const saved = loadManifest(tmpDir);
    // Should have rollback transitions (correction + escalation)
    const rollbacks = saved.transitions.filter((t) => t.artifact_id === "_rollback");
    expect(rollbacks.length).toBeGreaterThan(0);
    // The last rollback should be from escalation
    const lastRollback = rollbacks[rollbacks.length - 1];
    expect(lastRollback.reason).toContain("escalation rollback");

    // After rollback, execution checkpoint should still exist
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    // No cp-done since it failed
    expect(findCheckpointByPhase(saved, "done")).toBeUndefined();
  });

  it("all specialists fail → manifest restored", async () => {
    seedManifest();
    let specCallCount = 0;
    const failRunner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "reviewer") return {
        review_report: "ok",
        disposition_recommendation: "PASS" as const,
        issues: [],
      };
      // All specialists crash
      specCallCount++;
      throw new Error("specialist crash");
    };

    const result = await runTier2(
      makeConfig(failRunner, { maxRetries: 0 }),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(false);
    expect(result.phase).toBe("execution");

    const saved = loadManifest(tmpDir);
    // Execution checkpoint should exist (created before specialist execution)
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    // No review or done checkpoints
    expect(findCheckpointByPhase(saved, "review")).toBeUndefined();
    expect(findCheckpointByPhase(saved, "done")).toBeUndefined();
  });

  it("shared path tier3 escalation → execution checkpoint preserved", async () => {
    seedManifest();
    let callCount = 0;
    const tier3Runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "reviewer") return {
        review_report: "ok",
        disposition_recommendation: "PASS" as const,
        issues: [],
      };
      // Owner succeeds
      if (card.is_shared_owner) return {
        status: "done",
        touched_files: ["spec.md"],
        changeset: "diff",
        delta_stub: "stub",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
      // Consumer always blocked → eventually escalates to tier3
      callCount++;
      return {
        status: "blocked",
        touched_files: [],
        changeset: "blocked",
        delta_stub: "blocked",
        evidence: { build_pass: false, test_pass: false, test_summary: "blocked" },
        blocked_on: { reason: "shared_pending" as const, surface: "spec.md", owner_id: "specialist-1" },
      };
    };

    const brief = makeBrief({
      specialists: [
        { id: "specialist-1", scope: ["spec.md"], owns: ["spec.md"] },
        { id: "specialist-2", scope: ["tasks.md"], owns: [] },
      ],
      shared: ["spec.md"],
    });

    const result = await runTier2(
      makeConfig(tier3Runner),
      {
        task: "test",
        write_scope: ["spec.md", "tasks.md"],
        brief,
        shared_surfaces: [{ path: "spec.md", rule: "tier2_shared_protocol", owner: "specialist-1" }],
      },
    );

    expect(result.success).toBe(false);
    expect(result.tier3_escalation).toBe(true);

    const saved = loadManifest(tmpDir);
    // Execution checkpoint should still exist
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
  });
});
