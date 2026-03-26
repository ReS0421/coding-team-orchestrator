import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { ExecutionContract } from "../schemas/execution-contract.js";
import type { ProjectManifest } from "../store/types.js";

export interface LeadCrashContext {
  completed_specialist_results: SpecialistSubmission[];
  pending_specialist_ids: string[];
  original_cards: DispatchCard[];
  execution_contract: ExecutionContract;
  manifest_at_phase2_entry: ProjectManifest;
}

export interface RecoveryPlan {
  strategy: "respawn" | "restart_phase2" | "escalate";
  rehydrate_payload?: {
    contract: ExecutionContract;
    completed_results: SpecialistSubmission[];
    remaining_cards: DispatchCard[];
  };
  reason: string;
}

/**
 * Plan lead crash recovery.
 *
 * remaining_cards = original_cards filtered by pending_specialist_ids
 * (match by id === pending_id OR id.startsWith(pending_id + "-"))
 *
 * Logic:
 * - retryCount >= maxRetries → escalate
 * - completed > 0 → respawn (rehydrate with completed + remaining)
 * - completed == 0 → restart_phase2 (full restart from phase 2 entry)
 */
export function planLeadRecovery(
  context: LeadCrashContext,
  retryCount: number,
  maxRetries: number,
): RecoveryPlan {
  const {
    completed_specialist_results,
    pending_specialist_ids,
    original_cards,
    execution_contract,
    manifest_at_phase2_entry,
  } = context;

  // Escalate if retry limit reached
  if (retryCount >= maxRetries) {
    return {
      strategy: "escalate",
      reason: `Lead crash retry limit reached (${retryCount}/${maxRetries})`,
    };
  }

  // Find remaining cards (cards with pending IDs)
  const remaining_cards = original_cards.filter((card) =>
    pending_specialist_ids.some(
      (id) => card.id === id || card.id.startsWith(id + "-"),
    ),
  );

  const completedCount = completed_specialist_results.length;

  if (completedCount > 0) {
    // Respawn with partial progress
    return {
      strategy: "respawn",
      rehydrate_payload: {
        contract: execution_contract,
        completed_results: completed_specialist_results,
        remaining_cards,
      },
      reason: `Lead crashed after ${completedCount} specialists completed; respawning with remaining ${remaining_cards.length} cards`,
    };
  } else {
    // No progress → full restart from phase 2 entry
    return {
      strategy: "restart_phase2",
      rehydrate_payload: {
        contract: execution_contract,
        completed_results: [],
        remaining_cards: original_cards,
      },
      reason: "Lead crashed with no completed specialists; restarting Phase 2 from entry",
    };
  }
}
