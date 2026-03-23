import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier1, type OrchestratorConfig } from "../../src/engine/orchestrator.js";
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
