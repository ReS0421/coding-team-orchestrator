import { describe, it, expect } from "vitest";
import { runValidate } from "../../src/cli/commands/validate.js";

describe("CLI validate command", () => {
  it("should validate a correct specialist submission", () => {
    const input = {
      schema: "specialist_submission",
      data: {
        status: "done",
        touched_files: ["src/index.ts"],
        changeset: "diff content",
        delta_stub: "stub content",
        evidence: {
          build_pass: true,
          test_pass: true,
          test_summary: "3/3 pass",
        },
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should reject an invalid specialist submission", () => {
    const input = {
      schema: "specialist_submission",
      data: {
        status: "invalid_status",
        touched_files: [],
        changeset: "",
        delta_stub: "",
        evidence: { build_pass: true, test_pass: true, test_summary: "" },
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("should validate a correct reviewer return", () => {
    const input = {
      schema: "reviewer_return",
      data: {
        review_report: "All good",
        disposition_recommendation: "PASS",
        issues: [],
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(true);
  });

  it("should return error for unknown schema", () => {
    const input = { schema: "unknown", data: {} };
    const result = runValidate(input);
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("Unknown schema");
  });
});
