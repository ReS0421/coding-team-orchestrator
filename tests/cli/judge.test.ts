import { describe, it, expect } from "vitest";
import { runJudge } from "../../src/cli/commands/judge.js";

describe("CLI judge command", () => {
  it("should return tier 1 for simple input", () => {
    const input = {
      write_scope: ["src/index.ts"],
      specialist_count: 1,
    };
    const result = runJudge(input);
    expect(result.tier).toBe(1);
    expect(result).toHaveProperty("tier");
  });

  it("should return tier 2 for multi-specialist input", () => {
    const input = {
      write_scope: ["src/a.ts", "src/b.ts"],
      specialist_count: 2,
      shared_surfaces: [
        { path: "src/types.ts", rule: "append-only", owner: "spec-a" },
      ],
    };
    const result = runJudge(input);
    expect(result.tier).toBe(2);
  });

  it("should return tier 3 for 4+ specialists", () => {
    const input = {
      write_scope: ["src/a.ts"],
      specialist_count: 4,
    };
    const result = runJudge(input);
    expect(result.tier).toBe(3);
    expect(result.reason).toBeDefined();
  });
});
