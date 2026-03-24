import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { PlannerReturn } from "../../src/schemas/planner-return.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { CrossCheckEntry } from "../../src/schemas/reviewer-return.js";
import type { LeadReturn } from "../../src/schemas/lead-return.js";
import type { RunnerReturn } from "../../src/runners/types.js";
import type { RunnerOptions, TestRunnerFn } from "./runner-options.js";

// Re-export for backward compatibility
export type { RunnerReturn } from "../../src/runners/types.js";
export type { RunnerOptions, TestRunnerFn } from "./runner-options.js";
export type { RunnerFn } from "../../src/runners/types.js";

const DEFAULT_CROSS_CHECK: CrossCheckEntry[] = [
  { check: "scope_violation", pass: true },
  { check: "shared_file", pass: true },
  { check: "interface_mismatch", pass: true },
  { check: "test_coverage", pass: true },
  { check: "goal_met", pass: true },
];

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

// Sprint 3: shared-aware specialist tracking
const sharedCallCounts = new Map<string, number>();

function sharedSpecialist(card: DispatchCard, opts?: RunnerOptions): SpecialistSubmission {
  const sb = opts?.sharedBehavior;
  if (!sb) return defaultSpecialist(card, opts);

  // Owner behavior
  if (card.is_shared_owner) {
    if (!sb.ownerCommitSuccess) {
      throw new Error("Owner crash: " + card.id);
    }
    const sub = defaultSpecialist(card, opts);
    if (sb.sharedAmendmentFlag) {
      return { ...sub, shared_amendment_flag: true };
    }
    return sub;
  }

  // Consumer behavior
  if (sb.consumerBlockedOnShared) {
    const key = card.id;
    const count = (sharedCallCounts.get(key) ?? 0) + 1;
    sharedCallCounts.set(key, count);

    // First N calls blocked, then done
    if (count <= sb.consumerBlockedCount) {
      const surface = sb.undiscoveredShared.length > 0
        ? sb.undiscoveredShared[0]
        : card.shared_surface?.[0]?.path ?? "unknown";
      const ownerId = card.shared_surface?.[0]?.owner ?? "unknown";
      return {
        status: "blocked",
        touched_files: [],
        changeset: "blocked",
        delta_stub: "blocked",
        evidence: { build_pass: false, test_pass: false, test_summary: "blocked on shared" },
        blocked_on: { reason: "shared_pending", surface, owner_id: ownerId },
      };
    }
  }

  return defaultSpecialist(card, opts);
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
    cross_check: opts?.crossCheckOverride ?? DEFAULT_CROSS_CHECK,
  };
}

function failReviewer(card: DispatchCard): ReviewerReturn {
  return {
    review_report: "Review of " + card.id + ": FAIL",
    disposition_recommendation: "FAIL",
    issues: [
      {
        issue_id: "REV-AUTO-1",
        severity: "critical",
        blocking: true,
        evidence: "automated test failure",
        fix_owner: "specialist-1",
      },
    ],
    cross_check: [
      { check: "scope_violation", pass: true },
      { check: "shared_file", pass: true },
      { check: "interface_mismatch", pass: false, detail: "mismatch detected" },
      { check: "test_coverage", pass: true },
      { check: "goal_met", pass: false, detail: "goal not met" },
    ],
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

export const fakeRunner: TestRunnerFn = async (
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
      return opts?.sharedBehavior ? sharedSpecialist(card, opts) : defaultSpecialist(card, opts);
    case "reviewer":
      return defaultReviewer(card, opts);
    case "execution_lead":
      return defaultLead(card);
    default:
      throw new Error(`Unknown role: ${card.role}`);
  }
};

/**
 * Create a stateful runner that supports correction behavior.
 * Tracks reviewer call count for fail_then_pass scenarios.
 */
export function createStatefulRunner(opts?: RunnerOptions): TestRunnerFn {
  let reviewerCallCount = 0;

  return async (card: DispatchCard, runOpts?: RunnerOptions): Promise<RunnerReturn> => {
    const mergedOpts = { ...opts, ...runOpts };

    if (mergedOpts?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, mergedOpts.delayMs));
    }

    switch (card.role) {
      case "planner":
        return defaultPlanner(card);
      case "specialist":
      case "shared_owner":
        return mergedOpts?.sharedBehavior ? sharedSpecialist(card, mergedOpts) : defaultSpecialist(card, mergedOpts);
      case "reviewer": {
        reviewerCallCount++;
        const behavior = mergedOpts?.correctionBehavior ?? "always_pass";

        if (behavior === "always_fail") {
          return failReviewer(card);
        }
        if (behavior === "fail_then_pass" && reviewerCallCount === 1) {
          return failReviewer(card);
        }
        return defaultReviewer(card, mergedOpts);
      }
      case "execution_lead":
        return defaultLead(card);
      default:
        throw new Error(`Unknown role: ${card.role}`);
    }
  };
}
