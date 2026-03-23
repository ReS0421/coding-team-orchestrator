import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { RunnerReturn } from "../../src/runners/types.js";

// ─── Test-specific runner types ─────────────────────────

export interface RunnerOptions {
  statusOverride?: SpecialistSubmission["status"];
  evidenceOverride?: Partial<{
    build_pass: boolean;
    test_pass: boolean;
    test_summary: string;
  }>;
  dispositionOverride?: ReviewerReturn["disposition_recommendation"];
  delayMs?: number;
}

/**
 * Extended runner function for tests — accepts optional RunnerOptions.
 * Compatible with production RunnerFn when called without opts.
 */
export type TestRunnerFn = (
  card: DispatchCard,
  opts?: RunnerOptions,
) => Promise<RunnerReturn>;
