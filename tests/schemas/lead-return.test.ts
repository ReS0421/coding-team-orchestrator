import { describe, it, expect } from "vitest";
import {
  LeadReturnSchema,
  validateLeadReturn,
  safeValidateLeadReturn,
} from "../../src/schemas/lead-return.js";

const specialistResult = {
  status: "done",
  touched_files: ["src/main.ts"],
  changeset: "abc123",
  delta_stub: "diff",
  evidence: { build_pass: true, test_pass: true, test_summary: "OK" },
};

const manifestUpdates = {
  base_manifest_seq: 1,
  apply_mode: "all_or_fail",
  patches: [
    { artifact_id: "a1", op: "set", field: "status", new_value: "merged", reason: "done" },
  ],
};

const validLead = {
  final_merge_candidate: "abc123def",
  execution_summary: "All tasks completed successfully",
  specialist_results: [specialistResult],
  manifest_updates: manifestUpdates,
};

describe("LeadReturnSchema", () => {
  it("accepts valid lead return", () => {
    expect(LeadReturnSchema.safeParse(validLead).success).toBe(true);
  });

  it("accepts with rescue_log and escalation_log", () => {
    const full = {
      ...validLead,
      rescue_log: [{ task_id: "t1", trigger: "timeout", timestamp: "2026-03-23T12:00:00Z" }],
      escalation_log: [{ task_id: "t2", reason: "conflict", timestamp: "2026-03-23T12:01:00Z" }],
    };
    expect(LeadReturnSchema.safeParse(full).success).toBe(true);
  });

  it("accepts rescue_log with passthrough fields", () => {
    const data = {
      ...validLead,
      rescue_log: [
        { task_id: "t1", trigger: "timeout", timestamp: "2026-03-23T12:00:00Z", extra_field: 42 },
      ],
    };
    expect(LeadReturnSchema.safeParse(data).success).toBe(true);
  });

  it("rejects missing manifest_updates", () => {
    const { manifest_updates, ...rest } = validLead;
    expect(LeadReturnSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid specialist_results", () => {
    const bad = { ...validLead, specialist_results: [{ status: "invalid" }] };
    expect(LeadReturnSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects rescue_log with missing required fields", () => {
    const bad = { ...validLead, rescue_log: [{ task_id: "t1" }] };
    expect(LeadReturnSchema.safeParse(bad).success).toBe(false);
  });

  it("validateLeadReturn works", () => {
    const parsed = validateLeadReturn(validLead);
    expect(parsed.final_merge_candidate).toBe("abc123def");
  });

  it("validateLeadReturn throws on invalid", () => {
    expect(() => validateLeadReturn({})).toThrow();
  });

  it("safeValidateLeadReturn does not throw", () => {
    expect(safeValidateLeadReturn({}).success).toBe(false);
  });
});
