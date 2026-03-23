import { describe, it, expect } from "vitest";
import {
  ReviewerReturnSchema,
  validateReviewerReturn,
  safeValidateReviewerReturn,
} from "../../src/schemas/reviewer-return.js";

const validReturn = {
  review_report: "All checks passed.",
  disposition: "PASS",
  issues: [],
};

const validIssue = {
  issue_id: "ISS-001",
  severity: "critical",
  blocking: true,
  evidence: "Line 42 has null deref",
};

describe("ReviewerReturnSchema", () => {
  it("accepts valid return with no issues", () => {
    expect(ReviewerReturnSchema.safeParse(validReturn).success).toBe(true);
  });

  it("accepts return with issues", () => {
    const withIssues = { ...validReturn, disposition: "FAIL", issues: [validIssue] };
    expect(ReviewerReturnSchema.safeParse(withIssues).success).toBe(true);
  });

  it("accepts issue with optional fields", () => {
    const fullIssue = {
      ...validIssue,
      fix_owner: "specialist-2",
      deferrable: false,
      violated_contract: "no-null-deref",
    };
    const data = { ...validReturn, issues: [fullIssue] };
    expect(ReviewerReturnSchema.safeParse(data).success).toBe(true);
  });

  it("rejects invalid disposition", () => {
    expect(
      ReviewerReturnSchema.safeParse({ ...validReturn, disposition: "MAYBE" }).success,
    ).toBe(false);
  });

  it("rejects invalid severity in issue", () => {
    const bad = { ...validReturn, issues: [{ ...validIssue, severity: "low" }] };
    expect(ReviewerReturnSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing review_report", () => {
    const { review_report, ...rest } = validReturn;
    expect(ReviewerReturnSchema.safeParse(rest).success).toBe(false);
  });

  it("validateReviewerReturn works", () => {
    expect(validateReviewerReturn(validReturn).disposition).toBe("PASS");
  });

  it("safeValidateReviewerReturn does not throw", () => {
    expect(safeValidateReviewerReturn({}).success).toBe(false);
  });
});
