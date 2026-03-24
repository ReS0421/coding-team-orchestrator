import { describe, it, expect } from "vitest";
import { decideCorrection, type CorrectionContext } from "../../src/engine/correction.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { Brief } from "../../src/schemas/brief.js";
import { makeDispatchCard } from "../helpers/harness.js";

function makeReview(overrides?: Partial<ReviewerReturn>): ReviewerReturn {
  return {
    review_report: "Test review",
    disposition_recommendation: "FAIL",
    issues: [
      {
        issue_id: "REV-1",
        severity: "critical",
        blocking: true,
        evidence: "src/auth/token.ts:42",
        fix_owner: "specialist-1",
      },
    ],
    ...overrides,
  };
}

function makeBrief(): Brief {
  return {
    brief_id: "test",
    goal: "test goal",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: [] },
      { id: "specialist-2", scope: ["src/api/"], owns: [] },
    ],
    shared: [],
    accept_checks: ["build passes"],
    escalate_if: [],
  };
}

function makeContext(overrides?: Partial<CorrectionContext>): CorrectionContext {
  return {
    review_result: makeReview(),
    failed_specialist_ids: ["specialist-1"],
    original_cards: [
      makeDispatchCard({ id: "specialist-1-abc", role: "specialist", tier: 2 }),
      makeDispatchCard({ id: "specialist-2-abc", role: "specialist", tier: 2 }),
    ],
    brief: makeBrief(),
    correction_count: 0,
    max_corrections: 2,
    ...overrides,
  };
}

describe("decideCorrection", () => {
  it("returns fix_and_rereview for first correction with blocking issues", () => {
    const result = decideCorrection(makeContext());
    expect(result.disposition).toBe("fix_and_rereview");
    expect(result.re_dispatch_cards.length).toBeGreaterThan(0);
    expect(result.reviewer_re_dispatch).toBeDefined();
  });

  it("re-dispatch cards have incremented dispatch_rev", () => {
    const result = decideCorrection(makeContext());
    for (const card of result.re_dispatch_cards) {
      expect(card.dispatch_rev).toBe(2);
    }
  });

  it("re-dispatch card task is prefixed with [CORRECTION]", () => {
    const result = decideCorrection(makeContext());
    for (const card of result.re_dispatch_cards) {
      expect(card.task).toMatch(/^\[CORRECTION\]/);
    }
  });

  it("reviewer re-dispatch card is generated", () => {
    const result = decideCorrection(makeContext());
    expect(result.reviewer_re_dispatch).toBeDefined();
    expect(result.reviewer_re_dispatch!.role).toBe("reviewer");
    expect(result.reviewer_re_dispatch!.task).toMatch(/RE-REVIEW/);
  });

  it("escalates when correction_count >= max_corrections", () => {
    const result = decideCorrection(makeContext({ correction_count: 2 }));
    expect(result.disposition).toBe("escalate");
    expect(result.re_dispatch_cards).toEqual([]);
    expect(result.reviewer_re_dispatch).toBeUndefined();
  });

  it("aborts when no blocking issues", () => {
    const review = makeReview({
      issues: [
        { issue_id: "R1", severity: "minor", blocking: false, evidence: "..." },
      ],
    });
    const result = decideCorrection(makeContext({ review_result: review }));
    expect(result.disposition).toBe("abort");
    expect(result.re_dispatch_cards).toEqual([]);
  });

  it("aborts when issues array is empty", () => {
    const review = makeReview({ issues: [] });
    const result = decideCorrection(makeContext({ review_result: review }));
    expect(result.disposition).toBe("abort");
  });

  it("only re-dispatches failed specialists", () => {
    const ctx = makeContext({ failed_specialist_ids: ["specialist-1"] });
    const result = decideCorrection(ctx);
    expect(result.re_dispatch_cards).toHaveLength(1);
    expect(result.re_dispatch_cards[0].id).toContain("specialist-1");
  });

  it("generates reviewer card even without reviewer in original_cards", () => {
    const ctx = makeContext({
      original_cards: [
        makeDispatchCard({ id: "specialist-1-abc", role: "specialist", tier: 2 }),
      ],
    });
    const result = decideCorrection(ctx);
    expect(result.disposition).toBe("fix_and_rereview");
    expect(result.reviewer_re_dispatch).toBeDefined();
    expect(result.reviewer_re_dispatch!.role).toBe("reviewer");
  });
});
