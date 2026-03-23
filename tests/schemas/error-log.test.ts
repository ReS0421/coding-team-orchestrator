import { describe, it, expect } from "vitest";
import {
  ErrorLogSchema,
  validateErrorLog,
  safeValidateErrorLog,
} from "../../src/schemas/error-log.js";

const validLog = {
  session_id: "sess-001",
  role: "specialist",
  error_type: "timeout",
  timestamp: "2026-03-23T12:00:00Z",
  dispatch_rev: "rev-005",
  retry_count: 0,
  propagation_class: "local",
  affected_tasks: ["task-1"],
  artifact_refs: ["artifact-001"],
};

describe("ErrorLogSchema", () => {
  it("accepts a valid error log", () => {
    expect(ErrorLogSchema.safeParse(validLog).success).toBe(true);
  });

  it("accepts log with optional fields", () => {
    const full = { ...validLog, resolution: "retry", notes: "Will retry after cooldown" };
    expect(ErrorLogSchema.safeParse(full).success).toBe(true);
  });

  it("rejects invalid error_type", () => {
    expect(ErrorLogSchema.safeParse({ ...validLog, error_type: "unknown" }).success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    expect(ErrorLogSchema.safeParse({ ...validLog, timestamp: "not-a-date" }).success).toBe(false);
  });

  it("rejects negative retry_count", () => {
    expect(ErrorLogSchema.safeParse({ ...validLog, retry_count: -1 }).success).toBe(false);
  });

  it("rejects invalid propagation_class", () => {
    expect(
      ErrorLogSchema.safeParse({ ...validLog, propagation_class: "unknown" }).success,
    ).toBe(false);
  });

  it("rejects invalid resolution", () => {
    expect(
      ErrorLogSchema.safeParse({ ...validLog, resolution: "ignore" }).success,
    ).toBe(false);
  });

  it("accepts all 5 valid resolutions", () => {
    for (const r of ["retry", "skip", "escalate", "abort", "manual"]) {
      expect(ErrorLogSchema.safeParse({ ...validLog, resolution: r }).success).toBe(true);
    }
  });

  it("validateErrorLog returns parsed data", () => {
    const parsed = validateErrorLog(validLog);
    expect(parsed.session_id).toBe("sess-001");
  });

  it("validateErrorLog throws on invalid", () => {
    expect(() => validateErrorLog({})).toThrow();
  });

  it("safeValidateErrorLog does not throw", () => {
    const result = safeValidateErrorLog({});
    expect(result.success).toBe(false);
  });
});
