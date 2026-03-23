import { describe, it, expect } from "vitest";
import { validateReviewerReturn } from "../../src/schemas/reviewer-return.js";

const validReturn = {
  review_report: "reviews/report-001.md",
  disposition_recommendation: "PASS",
  issues: [],
};

describe("ReviewerReturn - valid", () => {
  it("parses PASS with no issues", () => {
    const result = validateReviewerReturn(validReturn);
    expect(result.disposition_recommendation).toBe("PASS");
  });
  it("parses FAIL with issues", () => {
    const withIssues = {
      ...validReturn,
      disposition_recommendation: "FAIL",
      issues: [{
        issue_id: "REV-001",
        severity: "critical",
        blocking: true,
        evidence: "src/auth/token.ts:42",
      }],
    };
    expect(() => validateReviewerReturn(withIssues)).not.toThrow();
  });
  it("parses CONDITIONAL", () => {
    expect(() => validateReviewerReturn({ ...validReturn, disposition_recommendation: "CONDITIONAL" })).not.toThrow();
  });
  it("parses issue with optional fields", () => {
    const full = {
      ...validReturn,
      issues: [{
        issue_id: "REV-001",
        severity: "major",
        blocking: true,
        evidence: "line 42",
        fix_owner: "specialist-2",
        deferrable: false,
        violated_contract: "spec §3.2",
      }],
    };
    expect(() => validateReviewerReturn(full)).not.toThrow();
  });
});

describe("ReviewerReturn - invalid", () => {
  it("rejects invalid disposition", () => {
    expect(() => validateReviewerReturn({ ...validReturn, disposition_recommendation: "MAYBE" })).toThrow();
  });
  it("rejects issue with invalid severity", () => {
    const badIssue = { ...validReturn, issues: [{ issue_id: "R1", severity: "blocker", blocking: true, evidence: "..." }] };
    expect(() => validateReviewerReturn(badIssue)).toThrow();
  });
});
