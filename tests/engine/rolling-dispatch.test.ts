import { describe, it, expect, vi } from "vitest";
import { runRollingDispatch, type RollingSlot } from "../../src/engine/rolling-dispatch.js";
import { RollingSlotState } from "../../src/domain/types.js";
import { makeDispatchCard } from "../helpers/harness.js";
import type { RunnerFn } from "../../src/runners/types.js";

function makeCard(id: string) {
  return makeDispatchCard({ id, role: "specialist", tier: 3 });
}

function makeSuccessRunner(): RunnerFn {
  return async (card) => ({
    status: "done",
    touched_files: [card.id + ".ts"],
    changeset: "changeset-" + card.id,
    delta_stub: "// delta",
    evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
  });
}

function makeFailRunner(failId: string): RunnerFn {
  return async (card) => {
    if (card.id === failId) throw new Error("Specialist crashed: " + failId);
    return {
      status: "done",
      touched_files: [card.id + ".ts"],
      changeset: "changeset-" + card.id,
      delta_stub: "// delta",
      evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
    };
  };
}

describe("runRollingDispatch", () => {
  it("5 cards span 3: processes all and all succeed", async () => {
    const cards = Array.from({ length: 5 }, (_, i) => makeCard(`s${i + 1}`));
    const result = await runRollingDispatch({
      active_span: 3,
      specialist_cards: cards,
      runner: makeSuccessRunner(),
    });
    expect(result.slots).toHaveLength(5);
    expect(result.all_succeeded).toBe(true);
    expect(result.failed_ids).toHaveLength(0);
    expect(result.slots.every((s) => s.state === RollingSlotState.COMPLETED)).toBe(true);
  });

  it("all succeed returns all_succeeded=true", async () => {
    const cards = [makeCard("a1"), makeCard("a2"), makeCard("a3")];
    const result = await runRollingDispatch({
      active_span: 2,
      specialist_cards: cards,
      runner: makeSuccessRunner(),
    });
    expect(result.all_succeeded).toBe(true);
    expect(result.failed_ids).toEqual([]);
  });

  it("1 fail: failed_ids has the failed id, others COMPLETED", async () => {
    const cards = [makeCard("x1"), makeCard("x2"), makeCard("x3")];
    const result = await runRollingDispatch({
      active_span: 3,
      specialist_cards: cards,
      runner: makeFailRunner("x2"),
    });
    expect(result.all_succeeded).toBe(false);
    expect(result.failed_ids).toContain("x2");
    const x1 = result.slots.find((s) => s.specialist_id === "x1");
    const x3 = result.slots.find((s) => s.specialist_id === "x3");
    expect(x1?.state).toBe(RollingSlotState.COMPLETED);
    expect(x3?.state).toBe(RollingSlotState.COMPLETED);
  });

  it("span 1: processes sequentially", async () => {
    const cards = Array.from({ length: 3 }, (_, i) => makeCard(`seq${i + 1}`));
    const result = await runRollingDispatch({
      active_span: 1,
      specialist_cards: cards,
      runner: makeSuccessRunner(),
    });
    expect(result.all_succeeded).toBe(true);
    expect(result.slots).toHaveLength(3);
  });

  it("span > cards: processes all normally", async () => {
    const cards = [makeCard("c1"), makeCard("c2")];
    const result = await runRollingDispatch({
      active_span: 10,
      specialist_cards: cards,
      runner: makeSuccessRunner(),
    });
    expect(result.all_succeeded).toBe(true);
    expect(result.slots).toHaveLength(2);
  });

  it("empty specialist_cards: returns empty slots", async () => {
    const result = await runRollingDispatch({
      active_span: 3,
      specialist_cards: [],
      runner: makeSuccessRunner(),
    });
    expect(result.slots).toHaveLength(0);
    expect(result.all_succeeded).toBe(true);
    expect(result.failed_ids).toHaveLength(0);
  });

  it("onSlotComplete callback is called for each slot", async () => {
    const cards = [makeCard("cb1"), makeCard("cb2"), makeCard("cb3")];
    const completedSlots: RollingSlot[] = [];
    await runRollingDispatch({
      active_span: 2,
      specialist_cards: cards,
      runner: makeSuccessRunner(),
      onSlotComplete: (slot) => completedSlots.push(slot),
    });
    expect(completedSlots).toHaveLength(3);
    expect(completedSlots.every((s) => s.state === RollingSlotState.COMPLETED)).toBe(true);
  });
});
