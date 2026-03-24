import { describe, it, expect } from "vitest";
import { resolveError, type ErrorResolutionContext } from "../../src/engine/error-resolution.js";

function makeCtx(overrides?: Partial<ErrorResolutionContext>): ErrorResolutionContext {
  return {
    error_type: "crash",
    retry_count: 0,
    max_retries: 1,
    correction_count: 0,
    max_corrections: 2,
    is_final_attempt: false,
    ...overrides,
  };
}

describe("resolveError", () => {
  it("returns retry when retries remain", () => {
    expect(resolveError(makeCtx())).toBe("retry");
  });

  it("returns escalate when retries exhausted", () => {
    expect(resolveError(makeCtx({ retry_count: 1, is_final_attempt: true }))).toBe("escalate");
  });

  it("returns escalate when correction budget exhausted", () => {
    expect(resolveError(makeCtx({ correction_count: 2, is_final_attempt: true }))).toBe("escalate");
  });

  it("returns abort for blocked error with retries exhausted", () => {
    expect(resolveError(makeCtx({
      error_type: "blocked",
      retry_count: 1,
      is_final_attempt: true,
    }))).toBe("abort");
  });

  it("returns retry for blocked with retries remaining", () => {
    expect(resolveError(makeCtx({
      error_type: "blocked",
      retry_count: 0,
      is_final_attempt: false,
    }))).toBe("retry");
  });

  it("returns escalate for timeout with retries exhausted", () => {
    expect(resolveError(makeCtx({
      error_type: "timeout",
      retry_count: 1,
      is_final_attempt: true,
    }))).toBe("escalate");
  });

  it("returns retry on first attempt for malformed_return", () => {
    expect(resolveError(makeCtx({ error_type: "malformed_return" }))).toBe("retry");
  });

  it("escalate takes priority over retry when corrections maxed", () => {
    expect(resolveError(makeCtx({
      retry_count: 0,
      correction_count: 2,
      is_final_attempt: true,
    }))).toBe("escalate");
  });

  it("returns escalate for silent_failure at final attempt", () => {
    expect(resolveError(makeCtx({
      error_type: "silent_failure",
      retry_count: 1,
      is_final_attempt: true,
    }))).toBe("escalate");
  });
});

describe("resolveError — tier3_escalation", () => {
  it("returns tier3_escalation when flag is set", () => {
    expect(resolveError(makeCtx({ tier3_escalation: true }))).toBe("tier3_escalation");
  });

  it("tier3_escalation takes priority over retry", () => {
    expect(resolveError(makeCtx({
      tier3_escalation: true,
      retry_count: 0,
      is_final_attempt: false,
    }))).toBe("tier3_escalation");
  });

  it("tier3_escalation takes priority over escalate", () => {
    expect(resolveError(makeCtx({
      tier3_escalation: true,
      correction_count: 2,
      is_final_attempt: true,
    }))).toBe("tier3_escalation");
  });

  it("does not return tier3_escalation when flag is false", () => {
    expect(resolveError(makeCtx({ tier3_escalation: false }))).toBe("retry");
  });

  it("does not return tier3_escalation when flag is undefined", () => {
    expect(resolveError(makeCtx())).toBe("retry");
  });
});
