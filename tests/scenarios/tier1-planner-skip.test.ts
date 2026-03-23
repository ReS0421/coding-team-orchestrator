import { describe, it, expect } from "vitest";
import { fakeRunner } from "../helpers/fake-runner.js";
import { makeDispatchCard, runScenario, assertResult } from "../helpers/harness.js";
import {
  validatePlannerReturn,
  validateSpecialistSubmission,
} from "../../src/schemas/index.js";
import type { PlannerReturn } from "../../src/schemas/planner-return.js";

describe("tier1-planner-skip: planner skipped, specialist only", () => {
  it("directly constructs PlannerReturn without calling runner", () => {
    const plannerReturn: PlannerReturn = {
      tasks_md: "# Tasks\n- implement feature",
      tier_recommendation: 1,
    };
    expect(() => validatePlannerReturn(plannerReturn)).not.toThrow();
    expect(plannerReturn.tasks_md).toContain("Tasks");
  });

  it("specialist runs independently after planner skip", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "skip-spec-001" });
    const result = await runScenario({
      name: "specialist-after-skip",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { status: "done" },
      },
    });
    assertResult(result, {
      should_succeed: true,
      return_assertions: { status: "done" },
    });
  });

  it("skipped planner return validates without runner invocation", () => {
    const plannerReturn: PlannerReturn = {
      tasks_md: "tasks.md",
    };
    const validated = validatePlannerReturn(plannerReturn);
    expect(validated.tasks_md).toBe("tasks.md");
    expect(validated.tier_recommendation).toBeUndefined();
  });

  it("specialist result is valid after planner skip flow", async () => {
    // Simulate: planner skipped (direct construction), then specialist runs
    const _skippedPlan: PlannerReturn = {
      tasks_md: "# Pre-planned tasks",
      tier_recommendation: 1,
    };

    const specCard = makeDispatchCard({
      role: "specialist",
      id: "skip-flow-001",
      write_scope: ["src/feature.ts"],
    });
    const result = await fakeRunner(specCard);
    const sub = validateSpecialistSubmission(result);
    expect(sub.status).toBe("done");
    expect(sub.touched_files).toEqual(["src/feature.ts"]);
  });

  it("planner skip does not affect specialist evidence", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const result = await fakeRunner(card);
    const sub = validateSpecialistSubmission(result);
    expect(sub.evidence.build_pass).toBe(true);
    expect(sub.evidence.test_pass).toBe(true);
    expect(sub.evidence.test_summary).toBe("all pass");
  });

  it("multiple specialists can run after planner skip", async () => {
    const cards = [
      makeDispatchCard({ role: "specialist", id: "multi-001", write_scope: ["a.ts"] }),
      makeDispatchCard({ role: "specialist", id: "multi-002", write_scope: ["b.ts"] }),
    ];
    const results = await Promise.all(cards.map((c) => fakeRunner(c)));
    expect(results).toHaveLength(2);
    results.forEach((r) => {
      expect(() => validateSpecialistSubmission(r)).not.toThrow();
    });
  });

  it("planner skip with brief_md still validates", () => {
    const plannerReturn: PlannerReturn = {
      tasks_md: "tasks.md",
      brief_md: "brief overview",
      tier_recommendation: 1,
    };
    const validated = validatePlannerReturn(plannerReturn);
    expect(validated.brief_md).toBe("brief overview");
  });
});
