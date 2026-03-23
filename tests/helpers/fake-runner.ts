import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { PlannerReturn } from "../../src/schemas/planner-return.js";
import type { SpecialistSubmission, Evidence } from "../../src/schemas/specialist-submission.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { LeadReturn } from "../../src/schemas/lead-return.js";

export type RunnerReturn =
  | PlannerReturn
  | SpecialistSubmission
  | ReviewerReturn
  | LeadReturn;

export interface RunnerOptions {
  statusOverride?: SpecialistSubmission["status"];
  evidenceOverride?: Partial<Evidence>;
  dispositionOverride?: ReviewerReturn["disposition_recommendation"];
  delayMs?: number;
}

export type RunnerFn = (
  card: DispatchCard,
  opts?: RunnerOptions,
) => Promise<RunnerReturn>;

function defaultSpecialist(card: DispatchCard, opts?: RunnerOptions): SpecialistSubmission {
  return {
    status: opts?.statusOverride ?? "done",
    touched_files: card.write_scope.length > 0 ? card.write_scope : ["output.ts"],
    changeset: "feat: implement " + card.id,
    delta_stub: "// delta",
    evidence: {
      build_pass: opts?.evidenceOverride?.build_pass ?? true,
      test_pass: opts?.evidenceOverride?.test_pass ?? true,
      test_summary: opts?.evidenceOverride?.test_summary ?? "all pass",
    },
  };
}

function defaultPlanner(card: DispatchCard): PlannerReturn {
  return {
    tasks_md: "tasks.md",
    tier_recommendation: card.tier,
  };
}

function defaultReviewer(card: DispatchCard, opts?: RunnerOptions): ReviewerReturn {
  return {
    review_report: "Review of " + card.id + ": PASS",
    disposition_recommendation: opts?.dispositionOverride ?? "PASS",
    issues: [],
  };
}

function defaultLead(card: DispatchCard): LeadReturn {
  return {
    final_merge_candidate: true,
    execution_summary: "Lead complete for " + card.id,
    specialist_results: [defaultSpecialist(card)],
    manifest_updates: {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: card.id,
          op: "set",
          field: "status",
          new_value: "done",
          reason: "lead complete",
        },
      ],
    },
  };
}

export const fakeRunner: RunnerFn = async (
  card: DispatchCard,
  opts?: RunnerOptions,
): Promise<RunnerReturn> => {
  if (opts?.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
  }

  switch (card.role) {
    case "planner":
      return defaultPlanner(card);
    case "specialist":
    case "shared_owner":
      return defaultSpecialist(card, opts);
    case "reviewer":
      return defaultReviewer(card, opts);
    case "execution_lead":
      return defaultLead(card);
    default:
      throw new Error(`Unknown role: ${card.role}`);
  }
};
