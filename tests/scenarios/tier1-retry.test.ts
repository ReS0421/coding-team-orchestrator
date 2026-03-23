import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fakeRunner } from "../helpers/fake-runner.js";
import { createCrashRunner } from "../helpers/crash-runner.js";
import { makeDispatchCard, runScenario, assertResult } from "../helpers/harness.js";
import { appendErrorLog, readNdjson } from "../../src/store/log-writer.js";
import type { ErrorLog } from "../../src/schemas/error-log.js";

describe("tier1-retry: crash then retry succeeds", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-retry-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("crash runner fails, log error, retry with fake runner succeeds", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "retry-001" });
    const crashRunner = createCrashRunner({ mode: "crash" });

    // First attempt: crash
    const crashResult = await runScenario({
      name: "crash-attempt",
      tier: 1,
      dispatch_card: card,
      runner: crashRunner,
      expected_result: { should_succeed: false, error_message_contains: "crashed" },
    });
    assertResult(crashResult, {
      should_succeed: false,
      error_message_contains: "crashed",
    });

    // Log the error
    const errorEntry: ErrorLog = {
      session_id: "session-001",
      role: "specialist",
      error_type: "crash",
      timestamp: new Date().toISOString(),
      dispatch_rev: 1,
      retry_count: 0,
      propagation_class: "contained",
      affected_tasks: [card.id],
      artifact_refs: [],
      resolution: "retry",
    };
    appendErrorLog(errorEntry, { logDir: tmpDir });

    // Retry: succeed
    const retryResult = await runScenario({
      name: "retry-attempt",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { status: "done" },
      },
    });
    assertResult(retryResult, {
      should_succeed: true,
      return_assertions: { status: "done" },
    });

    // Verify error log
    const errors = readNdjson<ErrorLog>(path.join(tmpDir, "errors.ndjson"));
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("crash");
    expect(errors[0].resolution).toBe("retry");
  });

  it("timeout runner fails and logs timeout error", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "timeout-001" });
    const timeoutRunner = createCrashRunner({ mode: "timeout", delayMs: 10 });

    const result = await runScenario({
      name: "timeout-attempt",
      tier: 1,
      dispatch_card: card,
      runner: timeoutRunner,
      expected_result: { should_succeed: false, error_message_contains: "timed out" },
    });
    assertResult(result, {
      should_succeed: false,
      error_message_contains: "timed out",
    });

    const errorEntry: ErrorLog = {
      session_id: "session-002",
      role: "specialist",
      error_type: "timeout",
      timestamp: new Date().toISOString(),
      dispatch_rev: 1,
      retry_count: 0,
      propagation_class: "contained",
      affected_tasks: [card.id],
      artifact_refs: [],
    };
    appendErrorLog(errorEntry, { logDir: tmpDir });

    const errors = readNdjson<ErrorLog>(path.join(tmpDir, "errors.ndjson"));
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe("timeout");
  });

  it("malformed_return runner returns invalid data", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "malformed-001" });
    const malformedRunner = createCrashRunner({ mode: "malformed_return" });

    const result = await runScenario({
      name: "malformed-attempt",
      tier: 1,
      dispatch_card: card,
      runner: malformedRunner,
      expected_result: { should_succeed: true },
    });
    // It "succeeds" (no throw) but returns invalid data
    expect(result.success).toBe(true);
    expect(result.return_value).toEqual({ invalid: true });

    const errorEntry: ErrorLog = {
      session_id: "session-003",
      role: "specialist",
      error_type: "malformed_return",
      timestamp: new Date().toISOString(),
      dispatch_rev: 1,
      retry_count: 0,
      propagation_class: "contained",
      affected_tasks: [card.id],
      artifact_refs: [],
    };
    appendErrorLog(errorEntry, { logDir: tmpDir });

    const errors = readNdjson<ErrorLog>(path.join(tmpDir, "errors.ndjson"));
    expect(errors[0].error_type).toBe("malformed_return");
  });

  it("silent_failure runner returns done but evidence fails", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "silent-001" });
    const silentRunner = createCrashRunner({ mode: "silent_failure" });

    const result = await runScenario({
      name: "silent-attempt",
      tier: 1,
      dispatch_card: card,
      runner: silentRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { status: "done", evidence_build_pass: false },
      },
    });
    assertResult(result, {
      should_succeed: true,
      return_assertions: { status: "done", evidence_build_pass: false },
    });

    const errorEntry: ErrorLog = {
      session_id: "session-004",
      role: "specialist",
      error_type: "silent_failure",
      timestamp: new Date().toISOString(),
      dispatch_rev: 1,
      retry_count: 0,
      propagation_class: "contained",
      affected_tasks: [card.id],
      artifact_refs: [],
    };
    appendErrorLog(errorEntry, { logDir: tmpDir });

    const errors = readNdjson<ErrorLog>(path.join(tmpDir, "errors.ndjson"));
    expect(errors[0].error_type).toBe("silent_failure");
  });

  it("multiple retries accumulate error log entries", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "multi-retry-001" });
    const crashRunner = createCrashRunner({ mode: "crash" });

    for (let i = 0; i < 3; i++) {
      await runScenario({
        name: `crash-attempt-${i}`,
        tier: 1,
        dispatch_card: card,
        runner: crashRunner,
        expected_result: { should_succeed: false },
      });
      appendErrorLog(
        {
          session_id: "session-multi",
          role: "specialist",
          error_type: "crash",
          timestamp: new Date().toISOString(),
          dispatch_rev: 1,
          retry_count: i,
          propagation_class: "contained",
          affected_tasks: [card.id],
          artifact_refs: [],
          resolution: i < 2 ? "retry" : "escalate",
        },
        { logDir: tmpDir },
      );
    }

    const errors = readNdjson<ErrorLog>(path.join(tmpDir, "errors.ndjson"));
    expect(errors).toHaveLength(3);
    expect(errors[0].retry_count).toBe(0);
    expect(errors[2].retry_count).toBe(2);
    expect(errors[2].resolution).toBe("escalate");
  });
});
