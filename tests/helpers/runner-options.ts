import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { CrossCheckEntry } from "../../src/schemas/reviewer-return.js";
import type { RunnerReturn } from "../../src/runners/types.js";

// ─── Test-specific runner types ─────────────────────────

export interface SharedBehavior {
  ownerCommitSuccess: boolean;
  consumerBlockedOnShared: boolean;
  consumerBlockedCount: number;
  sharedAmendmentFlag: boolean;
  undiscoveredShared: string[];
}

export interface RunnerOptions {
  statusOverride?: SpecialistSubmission["status"];
  evidenceOverride?: Partial<{
    build_pass: boolean;
    test_pass: boolean;
    test_summary: string;
  }>;
  dispositionOverride?: ReviewerReturn["disposition_recommendation"];
  crossCheckOverride?: CrossCheckEntry[];
  correctionBehavior?: "fail_then_pass" | "always_fail" | "always_pass";
  delayMs?: number;
  // Sprint 3: shared behavior
  sharedBehavior?: SharedBehavior;
}

/**
 * Extended runner function for tests — accepts optional RunnerOptions.
 * Compatible with production RunnerFn when called without opts.
 */
export type TestRunnerFn = (
  card: DispatchCard,
  opts?: RunnerOptions,
) => Promise<RunnerReturn>;
