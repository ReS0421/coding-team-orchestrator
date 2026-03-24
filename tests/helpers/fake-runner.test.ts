import { describe, it, expect } from "vitest";
import { fakeRunner } from "./fake-runner.js";
import { makeDispatchCard } from "./harness.js";
import {
  validateSpecialistSubmission,
  validatePlannerReturn,
  validateReviewerReturn,
  validateLeadReturn,
} from "../../src/schemas/index.js";

describe("fakeRunner", () => {
  it("returns valid SpecialistSubmission for specialist role", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const result = await fakeRunner(card);
    expect(() => validateSpecialistSubmission(result)).not.toThrow();
    const sub = result as ReturnType<typeof validateSpecialistSubmission>;
    expect(sub.status).toBe("done");
    expect(sub.touched_files).toEqual(["src/output.ts"]);
    expect(sub.evidence.build_pass).toBe(true);
    expect(sub.evidence.test_pass).toBe(true);
  });

  it("returns valid PlannerReturn for planner role", async () => {
    const card = makeDispatchCard({ role: "planner", tier: 2 });
    const result = await fakeRunner(card);
    expect(() => validatePlannerReturn(result)).not.toThrow();
    const plan = result as ReturnType<typeof validatePlannerReturn>;
    expect(plan.tasks_md).toBe("tasks.md");
    expect(plan.tier_recommendation).toBe(2);
  });

  it("returns valid ReviewerReturn for reviewer role", async () => {
    const card = makeDispatchCard({ role: "reviewer" });
    const result = await fakeRunner(card);
    expect(() => validateReviewerReturn(result)).not.toThrow();
    const rev = result as ReturnType<typeof validateReviewerReturn>;
    expect(rev.disposition_recommendation).toBe("PASS");
    expect(rev.issues).toEqual([]);
  });

  it("returns valid LeadReturn for execution_lead role", async () => {
    const card = makeDispatchCard({ role: "execution_lead" });
    const result = await fakeRunner(card);
    expect(() => validateLeadReturn(result)).not.toThrow();
    const lead = result as ReturnType<typeof validateLeadReturn>;
    expect(lead.final_merge_candidate).toBe(true);
    expect(lead.specialist_results.length).toBe(1);
  });

  it("returns valid SpecialistSubmission for shared_owner role", async () => {
    const card = makeDispatchCard({ role: "shared_owner" });
    const result = await fakeRunner(card);
    expect(() => validateSpecialistSubmission(result)).not.toThrow();
  });

  it("applies statusOverride option", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const result = await fakeRunner(card, { statusOverride: "blocked" });
    const sub = result as ReturnType<typeof validateSpecialistSubmission>;
    expect(sub.status).toBe("blocked");
  });

  it("applies evidenceOverride option", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const result = await fakeRunner(card, {
      evidenceOverride: { build_pass: false, test_summary: "build failed" },
    });
    const sub = result as ReturnType<typeof validateSpecialistSubmission>;
    expect(sub.evidence.build_pass).toBe(false);
    expect(sub.evidence.test_summary).toBe("build failed");
    expect(sub.evidence.test_pass).toBe(true);
  });

  it("applies dispositionOverride for reviewer", async () => {
    const card = makeDispatchCard({ role: "reviewer" });
    const result = await fakeRunner(card, { dispositionOverride: "FAIL" });
    const rev = result as ReturnType<typeof validateReviewerReturn>;
    expect(rev.disposition_recommendation).toBe("FAIL");
  });

  it("applies delayMs option", async () => {
    const card = makeDispatchCard({ role: "specialist" });
    const start = performance.now();
    await fakeRunner(card, { delayMs: 50 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("uses write_scope from card for touched_files", async () => {
    const card = makeDispatchCard({
      role: "specialist",
      write_scope: ["a.ts", "b.ts"],
    });
    const result = await fakeRunner(card);
    const sub = result as ReturnType<typeof validateSpecialistSubmission>;
    expect(sub.touched_files).toEqual(["a.ts", "b.ts"]);
  });
});

// ─── Sprint 3: shared behavior ─────────────────────────

import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";

function makeSharedCard(id: string, isOwner: boolean): DispatchCard {
  return {
    version: 1, dispatch_rev: 1, role: "specialist", id, tier: 2,
    task: "test", input_refs: [], entrypoint: [], must_read: [],
    authoritative_artifact: [], write_scope: ["src/"],
    completion_check: [], return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
    is_shared_owner: isOwner || undefined,
    shared_surface: [{ path: "src/shared.ts", rule: "tier2", owner: "owner-1" }],
  };
}

describe("fakeRunner — shared behavior", () => {
  it("owner succeeds with shared_amendment_flag", async () => {
    const result = await fakeRunner(makeSharedCard("owner-1", true), {
      sharedBehavior: {
        ownerCommitSuccess: true,
        consumerBlockedOnShared: false,
        consumerBlockedCount: 0,
        sharedAmendmentFlag: true,
        undiscoveredShared: [],
      },
    });
    expect((result as SpecialistSubmission).status).toBe("done");
    expect((result as SpecialistSubmission).shared_amendment_flag).toBe(true);
  });

  it("owner crashes when ownerCommitSuccess=false", async () => {
    await expect(fakeRunner(makeSharedCard("owner-1", true), {
      sharedBehavior: {
        ownerCommitSuccess: false,
        consumerBlockedOnShared: false,
        consumerBlockedCount: 0,
        sharedAmendmentFlag: false,
        undiscoveredShared: [],
      },
    })).rejects.toThrow("Owner crash");
  });

  it("consumer returns blocked then done on re-call", async () => {
    const card = makeSharedCard("consumer-1", false);
    const opts = {
      sharedBehavior: {
        ownerCommitSuccess: true,
        consumerBlockedOnShared: true,
        consumerBlockedCount: 1,
        sharedAmendmentFlag: false,
        undiscoveredShared: [],
      },
    };

    // First call: blocked
    const r1 = await fakeRunner(card, opts) as SpecialistSubmission;
    expect(r1.status).toBe("blocked");
    expect(r1.blocked_on?.reason).toBe("shared_pending");

    // Second call: done
    const r2 = await fakeRunner(card, opts) as SpecialistSubmission;
    expect(r2.status).toBe("done");
  });

  it("consumer uses undiscovered shared surface", async () => {
    const card = makeSharedCard("consumer-2", false);
    const result = await fakeRunner(card, {
      sharedBehavior: {
        ownerCommitSuccess: true,
        consumerBlockedOnShared: true,
        consumerBlockedCount: 1,
        sharedAmendmentFlag: false,
        undiscoveredShared: ["src/new-shared.ts"],
      },
    }) as SpecialistSubmission;
    expect(result.status).toBe("blocked");
    expect(result.blocked_on?.surface).toBe("src/new-shared.ts");
  });
});
