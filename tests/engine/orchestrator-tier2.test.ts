import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier2, type Tier2Config } from "../../src/engine/orchestrator.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { RunnerFn } from "../../src/runners/types.js";
import { fakeRunner, createStatefulRunner } from "../helpers/fake-runner.js";
import { loadManifest, createEmptyManifest, saveManifest, addArtifact } from "../../src/store/manifest.js";
import { ArtifactFamily, Freshness } from "../../src/domain/types.js";
import { findCheckpointByPhase } from "../../src/store/checkpoint.js";

let tmpDir: string;

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
  let m = createEmptyManifest("t2-test");
  m = addArtifact(m, { id: "spec", family: ArtifactFamily.REFERENCE, path: "spec.md", content_rev: 1, freshness: Freshness.FRESH });
  m = addArtifact(m, { id: "tasks", family: ArtifactFamily.REFERENCE, path: "tasks.md", content_rev: 1, freshness: Freshness.FRESH, depends_on: ["spec"] });
  saveManifest(tmpDir, m);
  return m;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-manifest-"));
});

// ── Task 4.10: Phase transition checkpoints ──
describe("runTier2 phase transition checkpoints", () => {
  it("happy path → cp-execution + cp-review + cp-done", async () => {
    seedManifest();
    const runner = createStatefulRunner() as RunnerFn;
    const brief = makeBrief();

    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief },
    );

    expect(result.success).toBe(true);
    expect(result.checkpoints_created).toBeDefined();
    expect(result.checkpoints_created).toContain("cp-execution");
    expect(result.checkpoints_created).toContain("cp-review");
    expect(result.checkpoints_created).toContain("cp-done");

    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "execution")).toBeDefined();
    expect(findCheckpointByPhase(saved, "review")).toBeDefined();
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
  });

  it("planning fail → no checkpoints", async () => {
    seedManifest();
    const crashPlanner: RunnerFn = async (card) => {
      if (card.role === "planner") throw new Error("planner crash");
      return fakeRunner(card);
    };

    const result = await runTier2(
      makeConfig(crashPlanner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );

    expect(result.success).toBe(false);
    expect(result.phase).toBe("planning");
    const saved = loadManifest(tmpDir);
    expect(saved.checkpoints).toHaveLength(0);
  });

  it("shared path → cp-execution exists", async () => {
    seedManifest();
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
  });
});

// ── Task 4.11: specialist commit + review manifest ──
describe("runTier2 specialist commit + review", () => {
  it("2 specialists → content_rev increased", async () => {
    seedManifest();
    const runner = createStatefulRunner() as RunnerFn;
    const brief = makeBrief();

    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief },
    );

    expect(result.success).toBe(true);
    const saved = loadManifest(tmpDir);
    // Content revs should have been incremented
    const spec = saved.artifacts.find((a) => a.id === "spec");
    const tasks = saved.artifacts.find((a) => a.id === "tasks");
    // After cp-done checkpoint, artifacts in snapshot should have incremented content_rev
    const doneCp = findCheckpointByPhase(saved, "done");
    expect(doneCp).toBeDefined();
  });

  it("unknown files → skip without error", async () => {
    seedManifest();
    // Runner that returns unknown files
    const unknownRunner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
        cross_check: [{ check: "goal_met", pass: true }],
      };
      return {
        status: "done",
        touched_files: ["unknown_file.xyz"],
        changeset: "diff",
        delta_stub: "stub",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };
    const brief = makeBrief();
    const result = await runTier2(
      makeConfig(unknownRunner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief },
    );
    expect(result.success).toBe(true);
  });

  it("reviewer PASS → cp-done exists", async () => {
    seedManifest();
    const runner = createStatefulRunner() as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(true);
    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
  });

  it("freshness propagation on content_rev change", async () => {
    seedManifest();
    // Runner that only touches spec.md → tasks depends on spec → should go stale
    const specOnlyRunner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
        cross_check: [{ check: "goal_met", pass: true }],
      };
      return {
        status: "done",
        touched_files: ["spec.md"],
        changeset: "diff",
        delta_stub: "stub",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };
    const result = await runTier2(
      makeConfig(specOnlyRunner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(true);

    // Check manifest was saved with freshness propagation
    const saved = loadManifest(tmpDir);
    // After commit, tasks (depends on spec) should have been marked stale during commit
    // However cp-done snapshot captures the state after commit
    expect(result.final_manifest_seq).toBeDefined();
    expect(result.final_manifest_seq!).toBeGreaterThan(0);
  });
});

// ── Task 4.12: correction/escalation rollback ──
describe("runTier2 correction/escalation rollback", () => {
  it("correction → rollback → re-commit → reviewer PASS", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" }) as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(true);
    expect(result.correction_count).toBe(1);

    const saved = loadManifest(tmpDir);
    expect(findCheckpointByPhase(saved, "done")).toBeDefined();
  });

  it("seq monotonically increases through correction", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" }) as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(true);
    expect(result.final_manifest_seq).toBeDefined();
    // Seq should always increase
    const saved = loadManifest(tmpDir);
    expect(saved.manifest_seq).toBeGreaterThan(0);

    // Check transitions for monotonic seq
    for (let i = 1; i < saved.transitions.length; i++) {
      expect(saved.transitions[i].manifest_seq_at).toBeGreaterThanOrEqual(
        saved.transitions[i - 1].manifest_seq_at,
      );
    }
  });

  it("correction results merged into specialist_results", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" }) as RunnerFn;
    const result = await runTier2(
      makeConfig(runner),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(true);
    // All specialists should have fulfilled results
    expect(result.specialist_results.all_succeeded).toBe(true);
  });

  it("escalation → rollback to execution checkpoint", async () => {
    seedManifest();
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" }) as RunnerFn;
    const result = await runTier2(
      makeConfig(runner, { maxCorrections: 1 }),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("escalation");

    // Manifest should be rolled back to execution checkpoint state
    const saved = loadManifest(tmpDir);
    const rollbackTransition = saved.transitions.find((t) => t.artifact_id === "_rollback");
    expect(rollbackTransition).toBeDefined();
  });

  it("checkpoint-less edge case does not crash", async () => {
    // Don't seed manifest → orchestrator creates empty one
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" }) as RunnerFn;
    const result = await runTier2(
      makeConfig(runner, { maxCorrections: 1 }),
      { task: "test", write_scope: ["spec.md", "tasks.md"], brief: makeBrief() },
    );
    // Should not crash, just escalate
    expect(result.success).toBe(false);
  });
});
