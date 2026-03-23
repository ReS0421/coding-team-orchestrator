import { describe, it, expect } from "vitest";
import { validateErrorLog } from "../../src/schemas/error-log.js";

const validEntry = {
  session_id: "sess-001",
  role: "specialist",
  error_type: "timeout",
  timestamp: "2026-03-23T10:00:00.000Z",
  dispatch_rev: 1,
  retry_count: 0,
  propagation_class: "contained",
  affected_tasks: [],
  artifact_refs: ["dispatch/specialist-1.md@rev1"],
};

describe("ErrorLog - valid", () => {
  it("parses a minimal valid entry", () => {
    const result = validateErrorLog(validEntry);
    expect(result.error_type).toBe("timeout");
    expect(result.propagation_class).toBe("contained");
  });
  it("parses with resolution and notes", () => {
    expect(() => validateErrorLog({ ...validEntry, resolution: "retry", notes: "first retry" })).not.toThrow();
  });
  it("parses global_escalation propagation", () => {
    expect(() => validateErrorLog({ ...validEntry, propagation_class: "global_escalation" })).not.toThrow();
  });
  it("parses all error types", () => {
    const types = ["timeout", "crash", "stalled", "blocked", "needs_context", "malformed_return", "silent_failure"];
    types.forEach((t) => expect(() => validateErrorLog({ ...validEntry, error_type: t })).not.toThrow());
  });
  it("parses all roles", () => {
    const roles = ["planner", "specialist", "execution_lead", "shared_owner", "reviewer"];
    roles.forEach((r) => expect(() => validateErrorLog({ ...validEntry, role: r })).not.toThrow());
  });
  it("parses all resolution types", () => {
    const resolutions = ["retry", "reassign", "escalate", "abort", "salvage"];
    resolutions.forEach((r) => expect(() => validateErrorLog({ ...validEntry, resolution: r })).not.toThrow());
  });
});

describe("ErrorLog - invalid", () => {
  it("rejects invalid timestamp format", () => {
    expect(() => validateErrorLog({ ...validEntry, timestamp: "not-a-date" })).toThrow();
  });
  it("rejects unknown error_type", () => {
    expect(() => validateErrorLog({ ...validEntry, error_type: "unknown_error" })).toThrow();
  });
  it("rejects invalid propagation_class", () => {
    expect(() => validateErrorLog({ ...validEntry, propagation_class: "local" })).toThrow();
  });
  it("rejects invalid role", () => {
    expect(() => validateErrorLog({ ...validEntry, role: "manager" })).toThrow();
  });
  it("rejects string dispatch_rev", () => {
    expect(() => validateErrorLog({ ...validEntry, dispatch_rev: "v1" })).toThrow();
  });
});
