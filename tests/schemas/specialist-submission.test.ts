import { describe, it, expect } from "vitest";
import {
  SpecialistSubmissionSchema,
  validateSpecialistSubmission,
  safeValidateSpecialistSubmission,
} from "../../src/schemas/specialist-submission.js";

const validSubmission = {
  status: "done",
  touched_files: ["src/index.ts", "src/util.ts"],
  changeset: "abc123",
  delta_stub: "diff --git a/src/index.ts",
  evidence: {
    build_pass: true,
    test_pass: true,
    test_summary: "42 tests passed",
  },
};

describe("SpecialistSubmissionSchema", () => {
  it("accepts a valid submission", () => {
    expect(SpecialistSubmissionSchema.safeParse(validSubmission).success).toBe(true);
  });

  it("accepts submission with optional fields", () => {
    const full = {
      ...validSubmission,
      status: "blocked",
      risk_notes: "Potential memory leak",
      shared_amendment_flag: true,
      blocked_reason: "Waiting on API access",
    };
    expect(SpecialistSubmissionSchema.safeParse(full).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(
      SpecialistSubmissionSchema.safeParse({ ...validSubmission, status: "cancelled" }).success,
    ).toBe(false);
  });

  it("rejects missing evidence", () => {
    const { evidence, ...rest } = validSubmission;
    expect(SpecialistSubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects incomplete evidence", () => {
    const bad = { ...validSubmission, evidence: { build_pass: true } };
    expect(SpecialistSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it("validateSpecialistSubmission returns parsed data", () => {
    const parsed = validateSpecialistSubmission(validSubmission);
    expect(parsed.status).toBe("done");
  });

  it("validateSpecialistSubmission throws on invalid", () => {
    expect(() => validateSpecialistSubmission({})).toThrow();
  });

  it("safeValidateSpecialistSubmission does not throw", () => {
    const result = safeValidateSpecialistSubmission({});
    expect(result.success).toBe(false);
  });
});
