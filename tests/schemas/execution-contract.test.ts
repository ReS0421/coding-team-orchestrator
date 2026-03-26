import { describe, it, expect } from "vitest";
import {
  validateExecutionContract,
  safeValidateExecutionContract,
  ExecutionContractSchema,
  SpecialistAssignmentSchema,
} from "../../src/schemas/execution-contract.js";

const validContract = {
  contract_id: "contract-1",
  brief_id: "brief-1",
  specialist_assignments: [
    { specialist_id: "s1", task: "implement auth" },
  ],
};

describe("SpecialistAssignmentSchema", () => {
  it("validates a minimal assignment with defaults", () => {
    const result = SpecialistAssignmentSchema.parse({
      specialist_id: "s1",
      task: "implement auth",
    });
    expect(result.shared_owner).toBe(false);
    expect(result.priority).toBe(1);
  });

  it("accepts explicit shared_owner and priority", () => {
    const result = SpecialistAssignmentSchema.parse({
      specialist_id: "s2",
      task: "implement shared interface",
      shared_owner: true,
      priority: 2,
    });
    expect(result.shared_owner).toBe(true);
    expect(result.priority).toBe(2);
  });

  it("rejects empty specialist_id", () => {
    const result = SpecialistAssignmentSchema.safeParse({ specialist_id: "", task: "task" });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionContractSchema", () => {
  it("validates a valid contract with defaults", () => {
    const result = validateExecutionContract(validContract);
    expect(result.contract_id).toBe("contract-1");
    expect(result.active_span).toBe(3);
    expect(result.shared_surfaces).toEqual([]);
  });

  it("accepts full contract with all fields", () => {
    const full = {
      ...validContract,
      specialist_assignments: [
        { specialist_id: "s1", task: "task1", shared_owner: true, priority: 1 },
        { specialist_id: "s2", task: "task2" },
      ],
      shared_surfaces: ["src/api.ts", "src/types.ts"],
      active_span: 2,
      implementability_notes: "All changes are scoped",
    };
    const result = validateExecutionContract(full);
    expect(result.specialist_assignments).toHaveLength(2);
    expect(result.shared_surfaces).toHaveLength(2);
    expect(result.active_span).toBe(2);
  });

  it("rejects empty specialist_assignments", () => {
    const result = safeValidateExecutionContract({
      ...validContract,
      specialist_assignments: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects active_span < 1", () => {
    const result = safeValidateExecutionContract({
      ...validContract,
      active_span: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing brief_id", () => {
    const result = safeValidateExecutionContract({
      contract_id: "c1",
      specialist_assignments: [{ specialist_id: "s1", task: "t" }],
    });
    expect(result.success).toBe(false);
  });
});
