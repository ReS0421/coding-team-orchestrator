import { describe, it, expect } from "vitest";
import { createCrashRunner } from "./crash-runner.js";
import { makeDispatchCard } from "./harness.js";
import { safeValidateSpecialistSubmission } from "../../src/schemas/index.js";

describe("createCrashRunner", () => {
  const card = makeDispatchCard({ role: "specialist" });

  it("timeout mode: delays then throws", async () => {
    const runner = createCrashRunner({ mode: "timeout", delayMs: 50 });
    const start = performance.now();
    await expect(runner(card)).rejects.toThrow("Runner timed out");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("crash mode: throws immediately", async () => {
    const runner = createCrashRunner({ mode: "crash" });
    await expect(runner(card)).rejects.toThrow("Runner crashed");
  });

  it("crash mode: uses custom error message", async () => {
    const runner = createCrashRunner({
      mode: "crash",
      errorMessage: "custom boom",
    });
    await expect(runner(card)).rejects.toThrow("custom boom");
  });

  it("malformed_return mode: returns schema-invalid object", async () => {
    const runner = createCrashRunner({ mode: "malformed_return" });
    const result = await runner(card);
    const validation = safeValidateSpecialistSubmission(result);
    expect(validation.success).toBe(false);
  });

  it("silent_failure mode: returns done with evidence false", async () => {
    const runner = createCrashRunner({ mode: "silent_failure" });
    const result = await runner(card);
    const sub = result as { status: string; evidence: { build_pass: boolean; test_pass: boolean } };
    expect(sub.status).toBe("done");
    expect(sub.evidence.build_pass).toBe(false);
    expect(sub.evidence.test_pass).toBe(false);
  });

  it("timeout mode: uses custom error message", async () => {
    const runner = createCrashRunner({
      mode: "timeout",
      delayMs: 10,
      errorMessage: "deadline exceeded",
    });
    await expect(runner(card)).rejects.toThrow("deadline exceeded");
  });
});
