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

// ─── Tier 3 correction tests ─────────────────────────────

import { decideTier3Correction, type Tier3CorrectionContext } from "../../src/engine/correction.js";

function makeTier3Context(overrides?: Partial<Tier3CorrectionContext>): Tier3CorrectionContext {
  return {
    review_result: makeReview(),
    failed_specialist_ids: ["specialist-1"],
    original_cards: [
      makeDispatchCard({ id: "specialist-1", role: "specialist", tier: 3 }),
      makeDispatchCard({ id: "reviewer-1", role: "reviewer", tier: 3 }),
    ],
    brief: makeBrief(),
    correction_count: 0,
    max_corrections: 4,
    per_fix_owner_count: { "specialist-1": 0 },
    max_per_fix_owner: 2,
    max_total_per_cycle: 4,
    ...overrides,
  };
}

describe("decideTier3Correction", () => {
  it("total >= max_total_per_cycle → escalate", () => {
    const ctx = makeTier3Context({
      per_fix_owner_count: { "specialist-1": 2, "specialist-2": 2 },
    });
    const result = decideTier3Correction(ctx);
    expect(result.disposition).toBe("escalate");
  });

  it("per_owner >= max + alt available → reassign", () => {
    const ctx = makeTier3Context({
      per_fix_owner_count: { "specialist-1": 2 },
      available_specialists: ["specialist-1", "specialist-2"],
    });
    const result = decideTier3Correction(ctx);
    expect(result.disposition).toBe("fix_and_rereview");
    expect(result.reassign_to).toBe("specialist-2");
  });

  it("per_owner >= max + no alt → escalate", () => {
    const ctx = makeTier3Context({
      per_fix_owner_count: { "specialist-1": 2 },
      available_specialists: ["specialist-1"], // only self
    });
    const result = decideTier3Correction(ctx);
    expect(result.disposition).toBe("escalate");
  });

  it("issue_persistence >= 2 → escalate", () => {
    const ctx = makeTier3Context({
      issue_persistence: { "REV-1": 2 },
    });
    const result = decideTier3Correction(ctx);
    expect(result.disposition).toBe("escalate");
  });

  it("no blocking issues → abort", () => {
    const ctx = makeTier3Context({
      review_result: makeReview({
        disposition_recommendation: "PASS",
        issues: [{ issue_id: "REV-1", severity: "minor", blocking: false, evidence: "minor issue" }],
      }),
    });
    const result = decideTier3Correction(ctx);
    expect(result.disposition).toBe("abort");
  });
});
