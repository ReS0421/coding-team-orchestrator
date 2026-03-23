import { describe, it, expect } from "vitest";
import {
  makeDispatchCard,
  runScenario,
  assertResult,
} from "./harness.js";
import { fakeRunner } from "./fake-runner.js";
import { createCrashRunner } from "./crash-runner.js";
import { validateDispatchCard } from "../../src/schemas/index.js";

describe("makeDispatchCard", () => {
  it("creates a valid DispatchCard with defaults", () => {
    const card = makeDispatchCard();
    expect(() => validateDispatchCard(card)).not.toThrow();
    expect(card.id).toBe("test-task-001");
    expect(card.role).toBe("specialist");
    expect(card.tier).toBe(1);
  });

  it("applies overrides", () => {
    const card = makeDispatchCard({ id: "custom-id", tier: 3, role: "planner" });
    expect(card.id).toBe("custom-id");
    expect(card.tier).toBe(3);
    expect(card.role).toBe("planner");
  });

  it("validates successfully via schema", () => {
    const card = makeDispatchCard({ role: "reviewer" });
    const result = validateDispatchCard(card);
    expect(result.role).toBe("reviewer");
  });
});

describe("runScenario", () => {
  it("returns success for a passing scenario", async () => {
    const card = makeDispatchCard();
    const result = await runScenario({
      name: "pass-test",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: { should_succeed: true },
    });
    expect(result.success).toBe(true);
    expect(result.scenario_name).toBe("pass-test");
    expect(result.return_value).toBeDefined();
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns failure for a crashing scenario", async () => {
    const card = makeDispatchCard();
    const crashRunner = createCrashRunner({ mode: "crash" });
    const result = await runScenario({
      name: "crash-test",
      tier: 1,
      dispatch_card: card,
      runner: crashRunner,
      expected_result: { should_succeed: false },
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("crashed");
  });

  it("passes runner_opts to runner", async () => {
    const card = makeDispatchCard();
    const result = await runScenario({
      name: "opts-test",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      runner_opts: { statusOverride: "blocked" },
      expected_result: { should_succeed: true },
    });
    const val = result.return_value as { status: string };
    expect(val.status).toBe("blocked");
  });
});

describe("assertResult", () => {
  it("passes when expected success matches actual success", () => {
    const result = {
      scenario_name: "test",
      success: true,
      return_value: { status: "done" } as never,
      elapsed_ms: 1,
    };
    expect(() =>
      assertResult(result, { should_succeed: true }),
    ).not.toThrow();
  });

  it("throws when expected success but got failure", () => {
    const result = {
      scenario_name: "test",
      success: false,
      error: new Error("oops"),
      elapsed_ms: 1,
    };
    expect(() =>
      assertResult(result, { should_succeed: true }),
    ).toThrow("Expected scenario");
  });

  it("throws when expected failure but got success", () => {
    const result = {
      scenario_name: "test",
      success: true,
      return_value: {} as never,
      elapsed_ms: 1,
    };
    expect(() =>
      assertResult(result, { should_succeed: false }),
    ).toThrow("Expected scenario");
  });

  it("validates error_message_contains on failure", () => {
    const result = {
      scenario_name: "test",
      success: false,
      error: new Error("connection refused"),
      elapsed_ms: 1,
    };
    expect(() =>
      assertResult(result, {
        should_succeed: false,
        error_message_contains: "connection",
      }),
    ).not.toThrow();
    expect(() =>
      assertResult(result, {
        should_succeed: false,
        error_message_contains: "timeout",
      }),
    ).toThrow('Expected error to contain "timeout"');
  });
});
