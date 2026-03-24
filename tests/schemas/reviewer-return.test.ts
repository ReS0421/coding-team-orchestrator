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

describe("ReviewerReturn - cross_check", () => {
  it("accepts return without cross_check (backward compat)", () => {
    expect(() => validateReviewerReturn(validReturn)).not.toThrow();
  });

  it("accepts return with valid cross_check entries", () => {
    const withCrossCheck = {
      ...validReturn,
      cross_check: [
        { check: "scope_violation", pass: true },
        { check: "shared_file", pass: true, detail: "no shared modifications" },
        { check: "interface_mismatch", pass: false, detail: "specialist-1 exports missing" },
        { check: "test_coverage", pass: true },
        { check: "goal_met", pass: true },
      ],
    };
    expect(() => validateReviewerReturn(withCrossCheck)).not.toThrow();
  });

  it("accepts empty cross_check array", () => {
    expect(() => validateReviewerReturn({ ...validReturn, cross_check: [] })).not.toThrow();
  });

  it("rejects invalid check type in cross_check", () => {
    const bad = {
      ...validReturn,
      cross_check: [{ check: "invalid_check", pass: true }],
    };
    expect(() => validateReviewerReturn(bad)).toThrow();
  });

  it("rejects cross_check entry missing pass field", () => {
    const bad = {
      ...validReturn,
      cross_check: [{ check: "scope_violation" }],
    };
    expect(() => validateReviewerReturn(bad)).toThrow();
  });
});
