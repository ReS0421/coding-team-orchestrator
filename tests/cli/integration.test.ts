import { describe, it, expect } from "vitest";
import { main } from "../../src/cli/index.js";

describe("CLI main integration", () => {
  it("should show usage when no command given", () => {
    const result = main([]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Usage");
  });

  it("should return error for unknown command", () => {
    const result = main(["unknown"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown command");
  });

  it("should run judge with valid JSON", () => {
    const input = JSON.stringify({ write_scope: ["src/a.ts"], specialist_count: 1 });
    const result = main(["judge", input]);
    expect(result.success).toBe(true);
    expect((result.data as any).tier).toBe(1);
  });

  it("should run validate with valid JSON", () => {
    const input = JSON.stringify({
      schema: "reviewer_return",
      data: {
        review_report: "Good",
        disposition_recommendation: "PASS",
        issues: [],
      },
    });
    const result = main(["validate", input]);
    expect(result.success).toBe(true);
    expect((result.data as any).valid).toBe(true);
  });

  it("should run dispatch with valid JSON", () => {
    const input = JSON.stringify({
      task: "Test",
      write_scope: ["src/a.ts"],
      brief: {
        brief_id: "b1",
        goal: "Test goal",
        out_of_scope: [],
        escalate_if: [],
        specialists: [{ id: "s1", scope: ["src/a.ts"], owns: [] }],
        shared: [],
        accept_checks: ["pass"],
      },
    });
    const result = main(["dispatch", input]);
    expect(result.success).toBe(true);
  });

  it("should handle invalid JSON gracefully", () => {
    const result = main(["judge", "not-json"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });
});
