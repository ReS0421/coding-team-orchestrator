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
