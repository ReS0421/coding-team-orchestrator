import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTier1 } from "../../src/engine/orchestrator.js";
import { createSpawnAdapter } from "../../src/runners/spawn-adapter.js";
import { fakeRunner, type RunnerFn } from "../helpers/fake-runner.js";
import { createCrashRunner } from "../helpers/crash-runner.js";
import { readNdjson } from "../../src/store/log-writer.js";
import type { TaskRequest } from "../../src/engine/dispatch-rule.js";

let tmpDir: string;
let projectRoot: string;
let logDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-test-"));
  projectRoot = tmpDir;
  logDir = path.join(tmpDir, "logs");
});

describe("Tier 1 E2E Integration", () => {
  it("full happy path: spawn adapter → runTier1 → success + manifest + event log", async () => {
    const runner = createSpawnAdapter({ mode: "fake", fakeRunner });
    const request: TaskRequest = {
      task: "Add login endpoint",
      write_scope: ["src/auth.ts"],
    };

    const result = await runTier1(
      { projectRoot, logDir, runner },
      request,
    );

    // 1. Success
    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    expect(result.specialist_result).toBeDefined();
    expect(result.specialist_result!.status).toBe("done");
    expect(result.specialist_result!.evidence.build_pass).toBe(true);
    expect(result.specialist_result!.evidence.test_pass).toBe(true);

    // 2. Manifest file created
    const manifestPath = path.join(projectRoot, "project-manifest.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);

    // 3. Event log written
    const events = readNdjson<Record<string, unknown>>(
      path.join(logDir, "events.ndjson"),
    );
    expect(events.length).toBe(1);
    expect(events[0].event).toBe("completed");
    expect(events[0].task).toBe("Add login endpoint");
  });

  it("retry scenario: crash then fake → event + error logs", async () => {
    const crashRunner = createCrashRunner({ mode: "crash", errorMessage: "network timeout" });

    let specialistCallCount = 0;
    const crashThenRecover: RunnerFn = async (card, opts) => {
      if (card.role === "planner") return fakeRunner(card, opts);
      specialistCallCount++;
      if (specialistCallCount === 1) {
        return crashRunner(card, opts);
      }
      return fakeRunner(card, opts);
    };

    const runner = createSpawnAdapter({ mode: "fake", fakeRunner: crashThenRecover });
    const request: TaskRequest = {
      task: "Fix database query",
      write_scope: ["src/db.ts"],
    };

    const result = await runTier1(
      { projectRoot, logDir, runner, maxRetries: 2 },
      request,
    );

    // Success after retry
    expect(result.success).toBe(true);
    expect(result.retry_count).toBe(1);

    // Error log has the crash entry
    const errors = readNdjson<Record<string, unknown>>(
      path.join(logDir, "errors.ndjson"),
    );
    expect(errors.length).toBe(1);
    expect(errors[0].error_type).toBe("crash");
    expect(errors[0].notes).toBe("network timeout");

    // Event log has the completed entry
    const events = readNdjson<Record<string, unknown>>(
      path.join(logDir, "events.ndjson"),
    );
    expect(events.length).toBe(1);
    expect(events[0].event).toBe("completed");
  });

  it("planner + specialist flow end-to-end", async () => {
    const runner = createSpawnAdapter({ mode: "fake", fakeRunner });
    const request: TaskRequest = {
      task: "Refactor utils",
      write_scope: ["src/utils.ts"],
    };

    // No pre-seeded manifest → planner will be required
    const result = await runTier1(
      { projectRoot, logDir, runner },
      request,
    );

    expect(result.success).toBe(true);
    expect(result.planner_result).toBeDefined();
    expect(result.planner_result!.tasks_md).toBeDefined();
    expect(result.specialist_result).toBeDefined();
  });

  it("max retries exceeded end-to-end", async () => {
    const crashRunner = createCrashRunner({ mode: "crash", errorMessage: "persistent failure" });
    const alwaysCrash: RunnerFn = async (card, opts) => {
      if (card.role === "planner") return fakeRunner(card, opts);
      return crashRunner(card, opts);
    };

    const runner = createSpawnAdapter({ mode: "fake", fakeRunner: alwaysCrash });
    const result = await runTier1(
      { projectRoot, logDir, runner, maxRetries: 1 },
      { task: "Failing task", write_scope: ["src/x.ts"] },
    );

    expect(result.success).toBe(false);
    expect(result.retry_count).toBe(1);

    // Error log has entries for each attempt
    const errors = readNdjson<Record<string, unknown>>(
      path.join(logDir, "errors.ndjson"),
    );
    expect(errors.length).toBe(2); // initial + 1 retry
  });
});
