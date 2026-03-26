import { describe, it, expect } from "vitest";
import { planLeadRecovery, type LeadCrashContext } from "../../src/engine/lead-recovery.js";
import { makeDispatchCard, makeBrief } from "../helpers/harness.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";
import type { ExecutionContract } from "../../src/schemas/execution-contract.js";
import type { ProjectManifest } from "../../src/store/types.js";

const contract: ExecutionContract = {
  contract_id: "c1",
  brief_id: "b1",
  specialist_assignments: [
    { specialist_id: "s1", task: "task1", shared_owner: false, priority: 1 },
    { specialist_id: "s2", task: "task2", shared_owner: false, priority: 1 },
    { specialist_id: "s3", task: "task3", shared_owner: false, priority: 1 },
  ],
  shared_surfaces: [],
  active_span: 3,
};

const manifest: ProjectManifest = {
  project: "test",
  manifest_seq: 5,
  artifacts: [],
  transitions: [],
  checkpoints: [],
};

function makeSubmission(id: string): SpecialistSubmission {
  return {
    status: "done",
    touched_files: [`src/${id}.ts`],
    changeset: `changeset-${id}`,
    delta_stub: "// delta",
    evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
  };
}

const cards = ["s1", "s2", "s3"].map((id) => makeDispatchCard({ id, role: "specialist", tier: 3 }));

describe("planLeadRecovery", () => {
  it("retryCount >= maxRetries → escalate", () => {
    const ctx: LeadCrashContext = {
      completed_specialist_results: [makeSubmission("s1")],
      pending_specialist_ids: ["s2", "s3"],
      original_cards: cards,
      execution_contract: contract,
      manifest_at_phase2_entry: manifest,
    };
    const plan = planLeadRecovery(ctx, 2, 2);
    expect(plan.strategy).toBe("escalate");
    expect(plan.reason).toContain("2/2");
  });

  it("completed > 0 → respawn with remaining cards", () => {
    const ctx: LeadCrashContext = {
      completed_specialist_results: [makeSubmission("s1")],
      pending_specialist_ids: ["s2", "s3"],
      original_cards: cards,
      execution_contract: contract,
      manifest_at_phase2_entry: manifest,
    };
    const plan = planLeadRecovery(ctx, 0, 2);
    expect(plan.strategy).toBe("respawn");
    expect(plan.rehydrate_payload?.remaining_cards).toHaveLength(2);
    expect(plan.rehydrate_payload?.completed_results).toHaveLength(1);
    expect(plan.rehydrate_payload?.contract).toBe(contract);
  });

  it("completed == 0 → restart_phase2 with all original cards", () => {
    const ctx: LeadCrashContext = {
      completed_specialist_results: [],
      pending_specialist_ids: ["s1", "s2", "s3"],
      original_cards: cards,
      execution_contract: contract,
      manifest_at_phase2_entry: manifest,
    };
    const plan = planLeadRecovery(ctx, 0, 2);
    expect(plan.strategy).toBe("restart_phase2");
    expect(plan.rehydrate_payload?.remaining_cards).toHaveLength(3);
  });

  it("remaining_cards filtered by pending_ids with prefix match", () => {
    const extCards = [
      makeDispatchCard({ id: "s1", role: "specialist", tier: 3 }),
      makeDispatchCard({ id: "s1-retry", role: "specialist", tier: 3 }),
      makeDispatchCard({ id: "s2", role: "specialist", tier: 3 }),
    ];
    const ctx: LeadCrashContext = {
      completed_specialist_results: [makeSubmission("s2")],
      pending_specialist_ids: ["s1"],
      original_cards: extCards,
      execution_contract: contract,
      manifest_at_phase2_entry: manifest,
    };
    const plan = planLeadRecovery(ctx, 0, 2);
    expect(plan.strategy).toBe("respawn");
    // Both s1 and s1-retry match pending_id "s1"
    expect(plan.rehydrate_payload?.remaining_cards).toHaveLength(2);
  });

  it("escalate at retry boundary", () => {
    const ctx: LeadCrashContext = {
      completed_specialist_results: [makeSubmission("s1")],
      pending_specialist_ids: ["s2"],
      original_cards: cards,
      execution_contract: contract,
      manifest_at_phase2_entry: manifest,
    };
    const plan = planLeadRecovery(ctx, 1, 1);
    expect(plan.strategy).toBe("escalate");
  });
});
