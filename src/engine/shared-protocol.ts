import type { Brief } from "../schemas/brief.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SharedChangeType } from "../domain/types.js";

// ─── Types ──────────────────────────────────────────────

export interface ExecutionSequence {
  ownerIds: string[];
  consumerIds: string[];
  sequence: "owner_first";
}

export interface SharedChangeEvaluation {
  type: SharedChangeType;
  severity: "low" | "high";
  needs_redispatch: boolean;
  needs_escalation: boolean;
}

export interface SharedChangeHistory {
  total_shared_changes: number;
  consumer_blocked_count: number;
  undiscovered_shared_surfaces: string[];
}

export interface SharedChangeAction {
  action: "redispatch_owner" | "escalate_tier3" | "continue";
  reason: string;
  re_dispatch_card?: DispatchCard;
}

// ─── Owner identification ───────────────────────────────

/**
 * Identify the shared owner from the brief.
 * The specialist who owns the most shared paths is the primary owner.
 * Ties broken by order in brief.specialists (first wins).
 */
export function identifySharedOwner(
  brief: Brief,
): { ownerId: string; sharedPaths: string[] } {
  if (brief.shared.length === 0) {
    return { ownerId: brief.specialists[0].id, sharedPaths: [] };
  }

  // Count how many shared paths each specialist owns
  const ownershipCount = new Map<string, number>();
  for (const spec of brief.specialists) {
    let count = 0;
    for (const sharedPath of brief.shared) {
      if (spec.owns.includes(sharedPath)) {
        count++;
      }
    }
    ownershipCount.set(spec.id, count);
  }

  // Find the specialist with the most shared ownership
  let bestId = brief.specialists[0].id;
  let bestCount = ownershipCount.get(bestId) ?? 0;
  for (const spec of brief.specialists) {
    const count = ownershipCount.get(spec.id) ?? 0;
    if (count > bestCount) {
      bestId = spec.id;
      bestCount = count;
    }
  }

  return { ownerId: bestId, sharedPaths: brief.shared };
}

// ─── Execution sequence ─────────────────────────────────

/**
 * Build the execution sequence from a brief with shared surfaces.
 * Owner specialists go first (spawn_order=1), consumers second (spawn_order=2).
 */
export function buildExecutionSequence(brief: Brief): ExecutionSequence {
  const { ownerId } = identifySharedOwner(brief);

  const ownerIds: string[] = [];
  const consumerIds: string[] = [];

  for (const spec of brief.specialists) {
    if (spec.id === ownerId) {
      ownerIds.push(spec.id);
    } else {
      consumerIds.push(spec.id);
    }
  }

  return { ownerIds, consumerIds, sequence: "owner_first" };
}

// ─── Shared change evaluation ───────────────────────────

/**
 * Evaluate a specialist submission for shared surface changes.
 * Consumes shared_amendment_flag and blocked_on.
 */
export function evaluateSharedChange(
  submission: SpecialistSubmission,
  _brief: Brief,
): SharedChangeEvaluation {
  // Case 1: shared_amendment_flag + done → unexpected amendment, low severity
  if (submission.shared_amendment_flag && submission.status === "done") {
    return {
      type: "unexpected_amendment",
      severity: "low",
      needs_redispatch: false,
      needs_escalation: false,
    };
  }

  // Case 2: shared_amendment_flag + blocked → consumer blocked, high severity
  if (submission.shared_amendment_flag && submission.status === "blocked") {
    return {
      type: "consumer_blocked",
      severity: "high",
      needs_redispatch: true,
      needs_escalation: false,
    };
  }

  // Case 3: blocked_on with shared_pending → consumer blocked, high severity
  if (submission.blocked_on?.reason === "shared_pending") {
    return {
      type: "consumer_blocked",
      severity: "high",
      needs_redispatch: true,
      needs_escalation: false,
    };
  }

  // Default: owner committed normally
  return {
    type: "owner_committed",
    severity: "low",
    needs_redispatch: false,
    needs_escalation: false,
  };
}

// ─── Tier 3 escalation triggers ─────────────────────────

/**
 * Check if the shared change history triggers Tier 3 escalation.
 * Any single trigger being true is sufficient.
 */
export function checkTier3EscalationTriggers(
  history: SharedChangeHistory,
): boolean {
  // Shared changes >= 2
  if (history.total_shared_changes >= 2) return true;

  // Undiscovered shared surfaces found
  if (history.undiscovered_shared_surfaces.length > 0) return true;

  // Consumer blocked on shared >= 2 times
  if (history.consumer_blocked_count >= 2) return true;

  return false;
}

// ─── Unexpected shared change handler ───────────────────

/**
 * Handle an unexpected shared change and decide action.
 * Pure function: returns action, caller handles logging.
 */
export function handleUnexpectedSharedChange(
  submission: SpecialistSubmission,
  brief: Brief,
  history: SharedChangeHistory,
): SharedChangeAction {
  const evaluation = evaluateSharedChange(submission, brief);

  // Check Tier 3 escalation first (includes undiscovered surfaces)
  if (checkTier3EscalationTriggers(history)) {
    return {
      action: "escalate_tier3",
      reason: buildEscalationReason(history),
    };
  }

  // Amendment done → continue, count was already incremented by caller
  if (evaluation.type === "unexpected_amendment" && evaluation.severity === "low") {
    return {
      action: "continue",
      reason: "Owner made unexpected shared amendment but completed successfully",
    };
  }

  // Consumer blocked on shared
  if (evaluation.needs_redispatch) {
    // Check if this would trigger escalation (total changes about to hit 2)
    if (history.total_shared_changes >= 1) {
      return {
        action: "escalate_tier3",
        reason: `Shared changes would reach ${history.total_shared_changes + 1} (threshold: 2)`,
      };
    }

    // Find the owner to re-dispatch
    const { ownerId } = identifySharedOwner(brief);
    const ownerCard = buildRedispatchCard(ownerId, submission, brief);

    return {
      action: "redispatch_owner",
      reason: `Consumer blocked on shared surface, re-dispatching owner ${ownerId}`,
      re_dispatch_card: ownerCard,
    };
  }

  return {
    action: "continue",
    reason: "No shared change issues detected",
  };
}

// ─── Helpers ────────────────────────────────────────────

function buildEscalationReason(history: SharedChangeHistory): string {
  const reasons: string[] = [];
  if (history.total_shared_changes >= 2) {
    reasons.push(`shared changes: ${history.total_shared_changes} (threshold: 2)`);
  }
  if (history.undiscovered_shared_surfaces.length > 0) {
    reasons.push(
      `undiscovered shared surfaces: ${history.undiscovered_shared_surfaces.join(", ")}`,
    );
  }
  if (history.consumer_blocked_count >= 2) {
    reasons.push(
      `consumer blocked count: ${history.consumer_blocked_count} (threshold: 2)`,
    );
  }
  return `Tier 3 escalation triggered: ${reasons.join("; ")}`;
}

function buildRedispatchCard(
  ownerId: string,
  submission: SpecialistSubmission,
  _brief: Brief,
): DispatchCard {
  const surface = submission.blocked_on?.surface ?? "unknown";
  return {
    version: 1,
    dispatch_rev: 2, // incremented from original rev 1
    role: "specialist",
    id: ownerId,
    tier: 2,
    task: `[SHARED RE-DISPATCH] Fix shared surface: ${surface}`,
    input_refs: [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [surface],
    completion_check: ["shared interface updated"],
    return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
    is_shared_owner: true,
    priority_task: `Fix shared interface: ${surface}`,
    spawn_order: 1,
  };
}
