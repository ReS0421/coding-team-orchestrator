import { describe, it, expect } from "vitest";
import { fakeRunner } from "../helpers/fake-runner.js";
import { makeDispatchCard, runScenario, assertResult } from "../helpers/harness.js";
import {
  validateSpecialistSubmission,
  validatePlannerReturn,
  validateReviewerReturn,
  validateLeadReturn,
} from "../../src/schemas/index.js";

describe("tier1-happy: all roles succeed", () => {
  it("specialist returns done with evidence pass", async () => {
    const card = makeDispatchCard({ role: "specialist", id: "spec-001" });
    const result = await runScenario({
      name: "specialist-happy",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { status: "done", evidence_build_pass: true },
      },
    });
    assertResult(result, result.return_value
      ? { should_succeed: true, return_assertions: { status: "done", evidence_build_pass: true } }
      : { should_succeed: true });
    expect(() => validateSpecialistSubmission(result.return_value)).not.toThrow();
  });

  it("reviewer returns PASS disposition", async () => {
    const card = makeDispatchCard({ role: "reviewer", id: "rev-001" });
    const result = await runScenario({
      name: "reviewer-happy",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { disposition: "PASS" },
      },
    });
    assertResult(result, {
      should_succeed: true,
      return_assertions: { disposition: "PASS" },
    });
    expect(() => validateReviewerReturn(result.return_value)).not.toThrow();
  });

  it("planner returns tasks_md", async () => {
    const card = makeDispatchCard({ role: "planner", id: "plan-001", tier: 1 });
    const result = await runScenario({
      name: "planner-happy",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: { should_succeed: true },
    });
    assertResult(result, { should_succeed: true });
    const plan = result.return_value as { tasks_md: string };
    expect(plan.tasks_md).toBeTruthy();
    expect(() => validatePlannerReturn(result.return_value)).not.toThrow();
  });

  it("execution_lead returns merge candidate true", async () => {
    const card = makeDispatchCard({ role: "execution_lead", id: "lead-001" });
    const result = await runScenario({
      name: "lead-happy",
      tier: 1,
      dispatch_card: card,
      runner: fakeRunner,
      expected_result: {
        should_succeed: true,
        return_assertions: { final_merge_candidate: true },
      },
    });
    assertResult(result, {
      should_succeed: true,
      return_assertions: { final_merge_candidate: true },
    });
    expect(() => validateLeadReturn(result.return_value)).not.toThrow();
  });

  it("specialist submission passes schema validation", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const result = await fakeRunner(card);
    const validated = validateSpecialistSubmission(result);
    expect(validated.status).toBe("done");
    expect(validated.evidence.build_pass).toBe(true);
    expect(validated.evidence.test_pass).toBe(true);
    expect(validated.changeset).toContain("feat:");
  });

  it("lead return contains valid specialist_results and manifest_updates", async () => {
    const card = makeDispatchCard({ role: "execution_lead", id: "lead-002" });
    const result = await fakeRunner(card);
    const lead = validateLeadReturn(result);
    expect(lead.specialist_results).toHaveLength(1);
    validateSpecialistSubmission(lead.specialist_results[0]);
    expect(lead.manifest_updates.patches).toHaveLength(1);
    expect(lead.manifest_updates.apply_mode).toBe("all_or_fail");
  });

  it("reviewer return has empty issues on PASS", async () => {
    const card = makeDispatchCard({ role: "reviewer", id: "rev-002" });
    const result = await fakeRunner(card);
    const rev = validateReviewerReturn(result);
    expect(rev.issues).toHaveLength(0);
    expect(rev.review_report).toContain("rev-002");
  });
});
