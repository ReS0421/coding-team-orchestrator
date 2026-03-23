import { describe, it, expect } from "vitest";
import { validateLeadReturn } from "../../src/schemas/lead-return.js";

const validReturn = {
  final_merge_candidate: true,
  execution_summary: "submissions/exec-summary.md",
  specialist_results: [{
    status: "done",
    touched_files: ["src/auth/handler.ts"],
    changeset: "submissions/s1-001.md",
    delta_stub: "submissions/delta-001.md",
    evidence: { build_pass: true, test_pass: true, test_summary: "5 passed" },
  }],
  manifest_updates: {
    base_manifest_seq: 10,
    apply_mode: "all_or_fail",
    patches: [{
      artifact_id: "tasks",
      op: "set",
      field: "lifecycle",
      new_value: "approved",
      reason: "execution complete",
    }],
  },
};

describe("LeadReturn - valid", () => {
  it("parses a valid return with manifest_updates", () => {
    const result = validateLeadReturn(validReturn);
    expect(result.final_merge_candidate).toBe(true);
    expect(result.specialist_results).toHaveLength(1);
  });
  it("parses with optional rescue_log", () => {
    const withRescue = {
      ...validReturn,
      rescue_log: [{ task_id: "task-1", trigger: "fix failed", timestamp: "2026-03-23T10:00:00.000Z" }],
    };
    expect(() => validateLeadReturn(withRescue)).not.toThrow();
  });
  it("final_merge_candidate false is valid", () => {
    expect(() => validateLeadReturn({ ...validReturn, final_merge_candidate: false })).not.toThrow();
  });
});

describe("LeadReturn - invalid", () => {
  it("rejects missing execution_summary", () => {
    const { execution_summary, ...noSummary } = validReturn;
    expect(() => validateLeadReturn(noSummary)).toThrow();
  });
  it("rejects missing manifest_updates", () => {
    const { manifest_updates, ...noManifest } = validReturn;
    expect(() => validateLeadReturn(noManifest)).toThrow();
  });
  it("rejects invalid specialist status in results", () => {
    const bad = { ...validReturn, specialist_results: [{ ...validReturn.specialist_results[0], status: "DONE" }] };
    expect(() => validateLeadReturn(bad)).toThrow();
  });
  it("rejects string final_merge_candidate", () => {
    expect(() => validateLeadReturn({ ...validReturn, final_merge_candidate: "yes" })).toThrow();
  });
});
