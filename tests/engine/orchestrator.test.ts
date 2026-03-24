import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier1, runTier2, type OrchestratorConfig } from "../../src/engine/orchestrator.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { TaskRequest } from "../../src/engine/dispatch-rule.js";
import type { RunnerFn } from "../../src/runners/types.js";
import { fakeRunner } from "../helpers/fake-runner.js";
import { createCrashRunner } from "../helpers/crash-runner.js";
import { readNdjson } from "../../src/store/log-writer.js";
import {
  createEmptyManifest,
  saveManifest,
  addArtifact,
} from "../../src/store/manifest.js";

let tmpDir: string;
let projectRoot: string;
let logDir: string;

function makeConfig(runner: RunnerFn, maxRetries?: number): OrchestratorConfig {
  return { projectRoot, logDir, runner, maxRetries };
}

function makeRequest(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    task: "Implement feature",
    write_scope: ["src/feature.ts"],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  projectRoot = tmpDir;
  logDir = path.join(tmpDir, "logs");
});

describe("runTier1", () => {
  it("happy path: fake runner → success", async () => {
    const result = await runTier1(makeConfig(fakeRunner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    expect(result.specialist_result).toBeDefined();
    expect(result.specialist_result!.status).toBe("done");
    expect(result.retry_count).toBe(0);
  });

  it("planner skip: tasks_md approved+fresh → needs_planner=false", async () => {
    // Pre-seed manifest with approved tasks_md
    const manifest = addArtifact(createEmptyManifest("test"), {
      id: "tasks_md",
      family: "reference",
      path: "tasks.md",
      content_rev: 1,
      lifecycle: "approved",
      freshness: "fresh",
    });
    saveManifest(projectRoot, manifest);

    let plannerCalled = false;
    const trackingRunner: RunnerFn = async (card) => {
      if (card.role === "planner") plannerCalled = true;
      return fakeRunner(card);
    };

    const result = await runTier1(makeConfig(trackingRunner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.planner_result).toBeUndefined();
    expect(plannerCalled).toBe(false);
  });

  it("planner required: no tasks_md → planner runs first", async () => {
    let plannerCalled = false;
    const trackingRunner: RunnerFn = async (card) => {
      if (card.role === "planner") plannerCalled = true;
      return fakeRunner(card);
    };

    const result = await runTier1(makeConfig(trackingRunner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.planner_result).toBeDefined();
    expect(result.planner_result!.tasks_md).toBeDefined();
    expect(plannerCalled).toBe(true);
  });

  it("retry: crash then success, retry_count === 1", async () => {
    let callCount = 0;
    const crashThenSucceed: RunnerFn = async (card) => {
      // Planner always succeeds
      if (card.role === "planner") return fakeRunner(card);
      callCount++;
      if (callCount === 1) {
        throw new Error("First attempt crash");
      }
      return fakeRunner(card);
    };

    const result = await runTier1(makeConfig(crashThenSucceed), makeRequest());
    expect(result.success).toBe(true);
    expect(result.retry_count).toBe(1);

    // Verify error log was written
    const errors = readNdjson(path.join(logDir, "errors.ndjson"));
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("max retries exceeded: always crash → success=false", async () => {
    const crashRunner = createCrashRunner({ mode: "crash", errorMessage: "always fails" });
    const alwaysCrash: RunnerFn = async (card) => {
      if (card.role === "planner") return fakeRunner(card);
      return crashRunner(card);
    };

    const result = await runTier1(makeConfig(alwaysCrash, 2), makeRequest());
    expect(result.success).toBe(false);
    expect(result.retry_count).toBe(2);
    expect(result.error).toContain("always fails");
  });

  it("evidence fail: build_pass=false triggers retry", async () => {
    let callCount = 0;
    const evidenceFailThenPass: RunnerFn = async (card) => {
      if (card.role === "planner") return fakeRunner(card);
      callCount++;
      if (callCount === 1) {
        return fakeRunner(card, { evidenceOverride: { build_pass: false } });
      }
      return fakeRunner(card);
    };

    const result = await runTier1(makeConfig(evidenceFailThenPass), makeRequest());
    expect(result.success).toBe(true);
    expect(result.retry_count).toBe(1);
  });

  it("tier 2 reject: shared_surfaces → error", async () => {
    const result = await runTier1(
      makeConfig(fakeRunner),
      makeRequest({
        shared_surfaces: [{ path: "shared.ts", rule: "lock", owner: "team-a" }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Tier 2/3 not supported yet");
  });

  it("event log written on success", async () => {
    await runTier1(makeConfig(fakeRunner), makeRequest());
    const events = readNdjson<Record<string, unknown>>(
      path.join(logDir, "events.ndjson"),
    );
    expect(events.length).toBe(1);
    expect(events[0].event).toBe("completed");
  });

  it("planner malformed return → failure with error log", async () => {
    const malformedPlanner: RunnerFn = async (card) => {
      if (card.role === "planner") {
        return { invalid: true } as any;
      }
      return fakeRunner(card);
    };

    const result = await runTier1(makeConfig(malformedPlanner), makeRequest());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Planner returned malformed data");

    const errors = readNdjson<Record<string, unknown>>(
      path.join(logDir, "errors.ndjson"),
    );
    expect(errors.length).toBe(1);
    expect(errors[0].error_type).toBe("malformed_return");
    expect(errors[0].role).toBe("planner");
  });

});

// ─── Sprint 3: runTier2 shared path tests ──────────────

import { createStatefulRunner } from "../helpers/fake-runner.js";

describe("runTier2 — shared path", () => {
  it("enters shared branch when brief has shared surfaces", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "test-shared",
      goal: "Test shared",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes.ts"] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"],
      escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot: tmpDir, logDir: tmpDir, runner },
      {
        task: "test shared",
        write_scope: ["src/auth/", "src/api/"],
        brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
      },
    );

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
    expect(result.shared_changes).toBe(0);
    expect(result.tier3_escalation).toBe(false);
  });

  it("creates manifest-lite when shared path", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "test-manifest-lite",
      goal: "Test",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"],
      escalate_if: [],
    };

    await runTier2(
      { projectRoot: tmpDir, logDir: tmpDir, runner },
      {
        task: "test",
        write_scope: ["src/auth/", "src/api/"],
        brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
      },
    );

    expect(fs.existsSync(path.join(tmpDir, "artifacts", "manifest-lite.yaml"))).toBe(true);
  });

  it("shared-free path still works (no regression)", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "test-no-shared",
      goal: "Test",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/auth/refresh.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes.ts"] },
      ],
      shared: [],
      accept_checks: ["build"],
      escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot: tmpDir, logDir: tmpDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief },
    );

    expect(result.success).toBe(true);
    expect(result.shared_changes).toBe(0);
    expect(result.acting_lead_id).toBeUndefined();
    expect(result.tier3_escalation).toBe(false);
  });

  it("returns tier3_escalation when shared execution escalates", async () => {
    let calls = 0;
    const runner: RunnerFn = async (card) => {
      calls++;
      if (card.role === "planner") return { tasks_md: "# tasks" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
      };
      // Specialist: owner succeeds, consumer always blocked
      if (card.is_shared_owner) return {
        status: "done" as const,
        touched_files: ["src/types/auth.ts"],
        changeset: "abc", delta_stub: "diff",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
      // Consumer blocked
      return {
        status: "blocked" as const,
        touched_files: [],
        changeset: "x", delta_stub: "x",
        evidence: { build_pass: false, test_pass: false, test_summary: "blocked" },
        blocked_on: { reason: "shared_pending" as const, surface: "src/types/auth.ts", owner_id: "specialist-1" },
      };
    };

    const brief: Brief = {
      brief_id: "test-escalation",
      goal: "Test",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"],
      escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot: tmpDir, logDir: tmpDir, runner },
      {
        task: "test",
        write_scope: ["src/auth/", "src/api/"],
        brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
      },
    );

    expect(result.success).toBe(false);
    expect(result.tier3_escalation).toBe(true);
  });
});
