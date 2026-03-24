import type { ErrorType } from "../domain/types.js";

export interface ErrorResolutionContext {
  error_type: ErrorType;
  retry_count: number;
  max_retries: number;        // per_session: 1
  correction_count: number;
  max_corrections: number;    // 2
  is_final_attempt: boolean;  // true if this is the last attempt in the current loop
  tier3_escalation?: boolean; // true if shared protocol signals Tier 3 upgrade
}

export type ErrorResolution = "retry" | "escalate" | "abort" | "tier3_escalation";

/**
 * Pure function: determine how to resolve an error.
 *
 * - tier3_escalation flag → tier3_escalation (shared protocol triggered)
 * - retry_count < max_retries → retry
 * - correction_count >= max_corrections → escalate
 * - blocked with no resolution path → abort
 * - else (retries exhausted) → escalate
 */
export function resolveError(ctx: ErrorResolutionContext): ErrorResolution {
  // Tier 3 escalation takes priority
  if (ctx.tier3_escalation) {
    return "tier3_escalation";
  }

  // Still have retries left
  if (ctx.retry_count < ctx.max_retries && !ctx.is_final_attempt) {
    return "retry";
  }

  // Correction budget exhausted
  if (ctx.correction_count >= ctx.max_corrections) {
    return "escalate";
  }

  // Blocked errors that can't be retried → abort
  if (ctx.error_type === "blocked" && ctx.retry_count >= ctx.max_retries) {
    return "abort";
  }

  // Retries exhausted for other error types → escalate
  if (ctx.retry_count >= ctx.max_retries) {
    return "escalate";
  }

  return "retry";
}
