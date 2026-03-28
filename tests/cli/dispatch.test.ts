import { describe, it, expect } from "vitest";
import { runDispatch } from "../../src/cli/commands/dispatch.js";

describe("CLI dispatch command", () => {
  it("should generate dispatch cards for a tier 2 brief", () => {
    const input = {
      task: "Add feature X",
      write_scope: ["src/a.ts", "src/b.ts"],
      brief: {
        brief_id: "test-brief",
        goal: "Add feature X",
        out_of_scope: [],
        escalate_if: [],
        specialists: [
          { id: "spec-a", scope: ["src/a.ts"], owns: [] },
          { id: "spec-b", scope: ["src/b.ts"], owns: [] },
        ],
        shared: [],
        accept_checks: ["tests pass"],
      },
    };
    const result = runDispatch(input);
    expect(result.tier).toBe(2);
    expect(result.specialist_cards.length).toBe(2);
    expect(result.reviewer_card).toBeDefined();
    expect(result.reviewer_card.role).toBe("reviewer");
  });

  it("should detect shared surfaces and assign owner", () => {
    const input = {
      task: "Modify shared types",
      write_scope: ["src/types.ts", "src/a.ts", "src/b.ts"],
      brief: {
        brief_id: "shared-brief",
        goal: "Modify shared types",
        out_of_scope: [],
        escalate_if: [],
        specialists: [
          { id: "spec-a", scope: ["src/a.ts"], owns: ["src/types.ts"] },
          { id: "spec-b", scope: ["src/b.ts"], owns: [] },
        ],
        shared: ["src/types.ts"],
        accept_checks: ["tests pass"],
      },
    };
    const result = runDispatch(input);
    expect(result.has_shared).toBe(true);
    const ownerCard = result.specialist_cards.find((c: any) => c.is_shared_owner);
    expect(ownerCard).toBeDefined();
  });
});
