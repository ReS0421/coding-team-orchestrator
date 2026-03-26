import { describe, it, expect } from "vitest";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import { createSpawnAdapter } from "../../src/runners/spawn-adapter.js";
import { fakeRunner } from "../helpers/fake-runner.js";
import { makeDispatchCard } from "../helpers/harness.js";

describe("createSpawnAdapter", () => {
  it("fake mode returns a working RunnerFn", async () => {
    const runner = createSpawnAdapter({ mode: "fake", fakeRunner: fakeRunner });
    const card = makeDispatchCard();
    const result = await runner(card);
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).status).toBe("done");
  });

  it("fake mode without fakeRunner throws", () => {
    expect(() => createSpawnAdapter({ mode: "fake" })).toThrow(
      "fakeRunner is required when mode is 'fake'",
    );
  });

  it("real mode throws not implemented", () => {
    expect(() => createSpawnAdapter({ mode: "real" })).toThrow(
      "realConfig is required",
    );
  });

  it("fake mode preserves runner behavior for planner role", async () => {
    const runner = createSpawnAdapter({ mode: "fake", fakeRunner: fakeRunner });
    const card = makeDispatchCard({ role: "planner", id: "planner-1" });
    const result = await runner(card);
    expect((result as Record<string, unknown>).tasks_md).toBeDefined();
  });
});

import { runParallel } from "../../src/runners/spawn-adapter.js";
import type { RunnerFn } from "../../src/runners/types.js";

describe("runParallel", () => {
  it("runs all cards in parallel and returns fulfilled results", async () => {
    const cards = [
      makeDispatchCard({ id: "s-1" }),
      makeDispatchCard({ id: "s-2" }),
    ];
    const result = await runParallel(cards, fakeRunner);
    expect(result.all_succeeded).toBe(true);
    expect(result.settled).toHaveLength(2);
    expect(result.failed_ids).toEqual([]);
    expect(result.settled[0].status).toBe("fulfilled");
    expect(result.settled[1].status).toBe("fulfilled");
  });

  it("captures failures without killing other runners", async () => {
    let callCount = 0;
    const mixedRunner: RunnerFn = async (card) => {
      callCount++;
      if (card.id === "s-fail") throw new Error("crash!");
      return fakeRunner(card);
    };
    const cards = [
      makeDispatchCard({ id: "s-ok" }),
      makeDispatchCard({ id: "s-fail" }),
    ];
    const result = await runParallel(cards, mixedRunner);
    expect(result.all_succeeded).toBe(false);
    expect(result.failed_ids).toEqual(["s-fail"]);
    expect(result.settled[0].status).toBe("fulfilled");
    expect(result.settled[1].status).toBe("rejected");
    expect(result.settled[1].error?.message).toBe("crash!");
    expect(callCount).toBe(2);
  });

  it("handles all failures", async () => {
    const crashRunner: RunnerFn = async () => { throw new Error("boom"); };
    const cards = [
      makeDispatchCard({ id: "s-1" }),
      makeDispatchCard({ id: "s-2" }),
    ];
    const result = await runParallel(cards, crashRunner);
    expect(result.all_succeeded).toBe(false);
    expect(result.failed_ids).toHaveLength(2);
  });

  it("handles empty card array", async () => {
    const result = await runParallel([], fakeRunner);
    expect(result.all_succeeded).toBe(true);
    expect(result.settled).toEqual([]);
  });

  it("preserves card id in settled results", async () => {
    const cards = [
      makeDispatchCard({ id: "alpha" }),
      makeDispatchCard({ id: "beta" }),
      makeDispatchCard({ id: "gamma" }),
    ];
    const result = await runParallel(cards, fakeRunner);
    expect(result.settled.map((s) => s.id)).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ─── Sprint 3: runSharedExecution ───────────────────────

import {
  runSharedExecution,
  type SharedExecutionOptions,
} from "../../src/runners/spawn-adapter.js";

function makeCard(id: string, overrides?: Partial<DispatchCard>): DispatchCard {
  return {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id,
    tier: 2,
    task: "test",
    input_refs: [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [],
    completion_check: [],
    return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
    ...overrides,
  };
}

const validSubmission = {
  status: "done" as const,
  touched_files: ["src/index.ts"],
  changeset: "abc",
  delta_stub: "diff",
  evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
};

describe("runSharedExecution", () => {
  it("runs owner then consumer in order", async () => {
    const callOrder: string[] = [];
    const runner = async (card: DispatchCard) => {
      callOrder.push(card.id);
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1", { is_shared_owner: true, spawn_order: 1 })],
      consumerCards: [makeCard("consumer-1", { selective_hold: true, spawn_order: 2 })],
      runner,
    });

    expect(callOrder[0]).toBe("owner-1");
    expect(callOrder[1]).toBe("consumer-1");
    expect(result.all_succeeded).toBe(true);
    expect(result.tier3_escalation).toBe(false);
  });

  it("owner failure → retry → success → consumer runs", async () => {
    let ownerCalls = 0;
    const runner = async (card: DispatchCard) => {
      if (card.id === "owner-1") {
        ownerCalls++;
        if (ownerCalls === 1) throw new Error("crash");
      }
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1")],
      consumerCards: [makeCard("consumer-1")],
      runner,
      maxOwnerRetries: 2,
    });

    expect(result.all_succeeded).toBe(true);
    expect(ownerCalls).toBe(2);
  });

  it("owner failure → retry exhausted → consumer skip", async () => {
    const runner = async (card: DispatchCard) => {
      if (card.id === "owner-1") throw new Error("crash");
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1")],
      consumerCards: [makeCard("consumer-1")],
      runner,
      maxOwnerRetries: 1,
    });

    expect(result.all_succeeded).toBe(false);
    expect(result.consumer_results.settled).toHaveLength(0);
  });

  it("consumer BLOCKED → onConsumerBlocked callback called", async () => {
    let callbackCalled = false;
    const blockedSubmission = {
      ...validSubmission,
      status: "blocked" as const,
      blocked_on: { reason: "shared_pending" as const, surface: "src/shared.ts", owner_id: "owner-1" },
    };

    let consumerCalls = 0;
    const runner = async (card: DispatchCard) => {
      if (card.id === "consumer-1") {
        consumerCalls++;
        if (consumerCalls === 1) return blockedSubmission;
      }
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1")],
      consumerCards: [makeCard("consumer-1")],
      runner,
      onConsumerBlocked: (_blocked, _ctx) => {
        callbackCalled = true;
        return "retry";
      },
    });

    expect(callbackCalled).toBe(true);
  });

  it("redispatch max exceeded → tier3_escalation", async () => {
    const blockedSubmission = {
      ...validSubmission,
      status: "blocked" as const,
      blocked_on: { reason: "shared_pending" as const, surface: "src/shared.ts", owner_id: "owner-1" },
    };

    const runner = async (card: DispatchCard) => {
      if (card.id === "consumer-1") return blockedSubmission;
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1")],
      consumerCards: [makeCard("consumer-1")],
      runner,
      onConsumerBlocked: () => "redispatch_owner",
      maxOwnerRedispatch: 0,
    });

    expect(result.tier3_escalation).toBe(true);
  });

  it("escalate_tier3 from callback → immediate stop", async () => {
    const blockedSubmission = {
      ...validSubmission,
      status: "blocked" as const,
      blocked_on: { reason: "shared_pending" as const, surface: "src/shared.ts", owner_id: "owner-1" },
    };

    const runner = async (card: DispatchCard) => {
      if (card.id === "consumer-1") return blockedSubmission;
      return validSubmission;
    };

    const result = await runSharedExecution({
      ownerCards: [makeCard("owner-1")],
      consumerCards: [makeCard("consumer-1")],
      runner,
      onConsumerBlocked: () => "escalate_tier3",
    });

    expect(result.tier3_escalation).toBe(true);
    expect(result.all_succeeded).toBe(false);
  });
});


describe("real spawn adapter", () => {
  const validSpecialistOutput = JSON.stringify({
    status: "done",
    touched_files: ["src/a.ts"],
    changeset: "changes",
    delta_stub: "// delta",
    evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
  });

  const makeSpecCard = (): import("../../src/schemas/dispatch-card.js").DispatchCard => ({
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id: "spec-1",
    tier: 2,
    task: "Implement feature",
    input_refs: [],
    entrypoint: ["src/index.ts"],
    must_read: [],
    authoritative_artifact: [],
    write_scope: ["src/a.ts"],
    completion_check: ["tests pass"],
    return_format: { schema: "SpecialistSubmission" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  });

  it("real mode: spawn success → returns RunnerReturn", async () => {
    const fakeSpawn = async () => ({ success: true, output: validSpecialistOutput });
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj" },
    });
    const result = await runner(makeSpecCard());
    expect((result as any).status).toBe("done");
  });

  it("real mode: spawn fail → retry → success", async () => {
    let calls = 0;
    const fakeSpawn = async () => {
      calls++;
      if (calls === 1) return { success: false, error: "timeout" };
      return { success: true, output: validSpecialistOutput };
    };
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj", defaultRetries: 1 },
    });
    const result = await runner(makeSpecCard());
    expect((result as any).status).toBe("done");
    expect(calls).toBe(2);
  });

  it("real mode: all retries fail → throws", async () => {
    const fakeSpawn = async () => ({ success: false, error: "crash" });
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj", defaultRetries: 1 },
    });
    await expect(runner(makeSpecCard())).rejects.toThrow("crash");
  });

  it("real mode: validation error → no retry", async () => {
    let calls = 0;
    const fakeSpawn = async () => {
      calls++;
      return { success: false, error: "validation failed" };
    };
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj", defaultRetries: 2 },
    });
    await expect(runner(makeSpecCard())).rejects.toThrow("validation");
    expect(calls).toBe(1);  // no retry on validation
  });

  it("real mode: missing realConfig → throws", () => {
    expect(() => createSpawnAdapter({ mode: "real" })).toThrow("realConfig is required");
  });

  it("real mode: spawn returns no output → retry", async () => {
    let calls = 0;
    const fakeSpawn = async () => {
      calls++;
      if (calls === 1) return { success: true, output: undefined };
      return { success: true, output: validSpecialistOutput };
    };
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj", defaultRetries: 1 },
    });
    const result = await runner(makeSpecCard());
    expect((result as any).status).toBe("done");
    expect(calls).toBe(2);
  });

  it("resolveRuntime: planner/reviewer → subagent, specialist → acp", async () => {
    const spawnCalls: Array<{ runtime: string }> = [];
    const fakeSpawn = async (_t: string, opts: any) => {
      spawnCalls.push({ runtime: opts.runtime });
      return { success: true, output: validSpecialistOutput };
    };
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: "/tmp/proj" },
    });

    await runner(makeSpecCard());
    expect(spawnCalls[0].runtime).toBe("acp");

    // planner return needs different format
    const plannerOutput = JSON.stringify({ tasks_md: "# plan" });
    const plannerSpawn = async (_t: string, opts: any) => {
      spawnCalls.push({ runtime: opts.runtime });
      return { success: true, output: plannerOutput };
    };
    const plannerRunner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: plannerSpawn, projectPath: "/tmp/proj" },
    });
    await plannerRunner({ ...makeSpecCard(), role: "planner" });
    expect(spawnCalls[1].runtime).toBe("subagent");
  });

  it("resolveTimeout: uses timeout_profile + custom map", async () => {
    const timeouts: number[] = [];
    const fakeSpawn = async (_t: string, opts: any) => {
      timeouts.push(opts.runTimeoutSeconds);
      return { success: true, output: validSpecialistOutput };
    };
    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: {
        spawn: fakeSpawn,
        projectPath: "/tmp/proj",
        timeoutMap: { standard: 999 },
      },
    });
    await runner(makeSpecCard());
    expect(timeouts[0]).toBe(999);
  });
});
