import { describe, it, expect } from "vitest";
import { runDualReview, mergeReviewIssues } from "../../src/engine/dual-reviewer.js";
import { makeDispatchCard } from "../helpers/harness.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { RunnerFn } from "../../src/runners/types.js";

function makeReviewerReturn(overrides: Partial<ReviewerReturn> = {}): ReviewerReturn {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "PASS",
    issues: [],
    ...overrides,
  };
}

function makePassRunner(): RunnerFn {
  return async () => makeReviewerReturn();
}

function makeReviewRunner(result: ReviewerReturn): RunnerFn {
  return async () => result;
}

const specCard = makeDispatchCard({ id: "spec-reviewer", role: "reviewer", tier: 3 });
const qualityCard = makeDispatchCard({ id: "quality-reviewer", role: "reviewer", tier: 3 });

describe("runDualReview", () => {
  it("both PASS → disposition PASS, empty merged_issues", async () => {
    const result = await runDualReview({
      spec_reviewer_card: specCard,
      quality_reviewer_card: qualityCard,
      runner: makePassRunner(),
    });
    expect(result.disposition).toBe("PASS");
    expect(result.merged_issues).toHaveLength(0);
    expect(result.spec_review.disposition_recommendation).toBe("PASS");
    expect(result.quality_review.disposition_recommendation).toBe("PASS");
  });

  it("spec FAIL with blocking → disposition FAIL", async () => {
    let callCount = 0;
    const runner: RunnerFn = async (card) => {
      callCount++;
      if (card.id === "spec-reviewer") {
        return makeReviewerReturn({
          disposition_recommendation: "FAIL",
          issues: [{ issue_id: "i1", severity: "critical", blocking: true, evidence: "missing test" }],
        });
      }
      return makeReviewerReturn();
    };
    const result = await runDualReview({
      spec_reviewer_card: specCard,
      quality_reviewer_card: qualityCard,
      runner,
    });
    expect(result.disposition).toBe("FAIL");
    expect(result.merged_issues.some((i) => i.blocking)).toBe(true);
  });

  it("throws when reviewer returns malformed data", async () => {
    const runner: RunnerFn = async () => {
      return { not_a_reviewer_return: true } as any;
    };
    await expect(
      runDualReview({ spec_reviewer_card: specCard, quality_reviewer_card: qualityCard, runner }),
    ).rejects.toThrow("malformed");
  });

  it("empty issues from both → PASS", async () => {
    const result = await runDualReview({
      spec_reviewer_card: specCard,
      quality_reviewer_card: qualityCard,
      runner: makePassRunner(),
    });
    expect(result.merged_issues).toHaveLength(0);
    expect(result.disposition).toBe("PASS");
  });
});

describe("mergeReviewIssues", () => {
  it("same issue_id: higher severity (critical) wins over minor", () => {
    const specIssues = [{ issue_id: "i1", severity: "minor" as const, blocking: false, evidence: "low" }];
    const qualityIssues = [{ issue_id: "i1", severity: "critical" as const, blocking: true, evidence: "high" }];
    const merged = mergeReviewIssues(specIssues, qualityIssues);
    expect(merged).toHaveLength(1);
    expect(merged[0].severity).toBe("critical");
    expect(merged[0].blocking).toBe(true);
  });

  it("different issue_ids: all included", () => {
    const specIssues = [{ issue_id: "s1", severity: "major" as const, blocking: true, evidence: "e1" }];
    const qualityIssues = [{ issue_id: "q1", severity: "minor" as const, blocking: false, evidence: "e2" }];
    const merged = mergeReviewIssues(specIssues, qualityIssues);
    expect(merged).toHaveLength(2);
  });
});
