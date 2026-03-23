import { describe, it, expect } from "vitest";
import {
  PlannerReturnSchema,
  validatePlannerReturn,
  safeValidatePlannerReturn,
} from "../../src/schemas/planner-return.js";

const valid = { tasks_md: "- [ ] Task 1\n- [ ] Task 2" };

describe("PlannerReturnSchema", () => {
  it("accepts minimal valid input", () => {
    expect(PlannerReturnSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const full = { ...valid, brief_md: "Quick summary", tier_recommendation: 1 };
    expect(PlannerReturnSchema.safeParse(full).success).toBe(true);
  });

  it("rejects empty tasks_md", () => {
    expect(PlannerReturnSchema.safeParse({ tasks_md: "" }).success).toBe(false);
  });

  it("rejects invalid tier_recommendation", () => {
    expect(PlannerReturnSchema.safeParse({ ...valid, tier_recommendation: 4 }).success).toBe(false);
  });

  it("validatePlannerReturn works", () => {
    expect(validatePlannerReturn(valid).tasks_md).toBe(valid.tasks_md);
  });

  it("safeValidatePlannerReturn does not throw on invalid", () => {
    expect(safeValidatePlannerReturn({}).success).toBe(false);
  });
});
