import { describe, it, expect } from "vitest";
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
      "Real spawn not implemented yet — Sprint 6",
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
