import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { PlannerReturn } from "../schemas/planner-return.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { ReviewerReturn } from "../schemas/reviewer-return.js";
import type { LeadReturn } from "../schemas/lead-return.js";

// ─── Runner types (production) ──────────────────────────

export type RunnerReturn =
  | PlannerReturn
  | SpecialistSubmission
  | ReviewerReturn
  | LeadReturn;

/**
 * Production runner function signature.
 * Takes a dispatch card and returns a schema-valid result.
 * Test helpers may extend this with additional options via TestRunnerFn.
 */
export type RunnerFn = (
  card: DispatchCard,
) => Promise<RunnerReturn>;

// ─── Parallel execution types ───────────────────────────

export interface SettledResult {
  id: string;
  status: "fulfilled" | "rejected";
  value?: RunnerReturn;
  error?: Error;
}

export interface ParallelResult {
  settled: SettledResult[];
  all_succeeded: boolean;
  failed_ids: string[];
}
