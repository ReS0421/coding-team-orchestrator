import type { ReviewerReturn } from "../schemas/reviewer-return.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { Brief } from "../schemas/brief.js";
import type { CorrectionDisposition } from "../domain/types.js";

export interface CorrectionContext {
  review_result: ReviewerReturn;
  failed_specialist_ids: string[];
  original_cards: DispatchCard[];
  brief: Brief;
  correction_count: number;
  max_corrections: number; // default 2
}

export interface CorrectionDecision {
  disposition: CorrectionDisposition;
  re_dispatch_cards: DispatchCard[];
  reviewer_re_dispatch?: DispatchCard;
}

/**
 * Decide correction action based on review result.
 *
 * - correction_count >= max_corrections → escalate
 * - no blocking issues → abort (nothing to fix)
 * - else → fix_and_rereview: generate re-dispatch cards with dispatch_rev+1
 */
export function decideCorrection(ctx: CorrectionContext): CorrectionDecision {
  // Max corrections exceeded → escalate
  if (ctx.correction_count >= ctx.max_corrections) {
    return {
      disposition: "escalate",
      re_dispatch_cards: [],
    };
  }

  // No blocking issues → abort (review is passable)
  const hasBlockingIssues = ctx.review_result.issues.some((i) => i.blocking);
  if (!hasBlockingIssues) {
    return {
      disposition: "abort",
      re_dispatch_cards: [],
    };
  }

  // Fix and re-review
  const re_dispatch_cards = ctx.original_cards
    .filter((card) =>
      ctx.failed_specialist_ids.some((failedId) => card.id === failedId || card.id.startsWith(failedId + "-")),
    )
    .map((card) => ({
      ...card,
      dispatch_rev: card.dispatch_rev + 1,
      task: card.task.startsWith("[CORRECTION]") ? card.task : `[CORRECTION] ${card.task}`,
    }));

  // If no matching cards found, re-dispatch all failed IDs' cards
  // (fallback: match by specialist index in brief)
  if (re_dispatch_cards.length === 0 && ctx.failed_specialist_ids.length > 0) {
    // Use the first original card as template
    for (const failedId of ctx.failed_specialist_ids) {
      const matching = ctx.original_cards.find((c) => c.id.includes(failedId));
      if (matching) {
        re_dispatch_cards.push({
          ...matching,
          dispatch_rev: matching.dispatch_rev + 1,
          task: `[CORRECTION] ${matching.task}`,
        });
      }
    }
  }

  // Reviewer re-dispatch card
  const reviewerTemplate = ctx.original_cards.find((c) => c.role === "reviewer");
  const reviewer_re_dispatch: DispatchCard | undefined = reviewerTemplate
    ? {
        ...reviewerTemplate,
        dispatch_rev: reviewerTemplate.dispatch_rev + 1,
        task: reviewerTemplate.task.startsWith("[RE-REVIEW]") ? reviewerTemplate.task : `[RE-REVIEW] ${reviewerTemplate.task}`,
        input_refs: re_dispatch_cards.map((c) => c.id),
      }
    : {
        version: 1,
        dispatch_rev: ctx.correction_count + 2,
        role: "reviewer",
        id: `reviewer-correction-${ctx.correction_count + 1}`,
        tier: 2,
        task: `[RE-REVIEW] correction round ${ctx.correction_count + 1}`,
        input_refs: re_dispatch_cards.map((c) => c.id),
        entrypoint: [],
        must_read: [],
        authoritative_artifact: [],
        write_scope: [],
        completion_check: ["spec check", "quality check", "cross check"],
        return_format: { schema: "reviewer_return_v1" },
        timeout_profile: { class: "standard", heartbeat_required: false },
      };

  return {
    disposition: "fix_and_rereview",
    re_dispatch_cards,
    reviewer_re_dispatch,
  };
}

// ─── Tier 3 Correction ──────────────────────────────────

export interface Tier3CorrectionContext extends CorrectionContext {
  per_fix_owner_count: Record<string, number>;
  max_per_fix_owner: number; // 2
  max_total_per_cycle: number; // 4
  issue_persistence?: Record<string, number>;
  available_specialists?: string[];
}

export interface Tier3CorrectionDecision extends CorrectionDecision {
  reassign_to?: string;
}

/**
 * Decide Tier 3 correction action with extended budget and reassignment support.
 *
 * Judgment order:
 * 1. total >= max_total_per_cycle → escalate
 * 2. per_owner >= max_per_fix_owner AND alt available → reassign
 * 3. per_owner >= max_per_fix_owner AND no alt → escalate
 * 4. issue_persistence >= 2 → escalate
 * 5. no blocking issues → abort
 * 6. else → fix_and_rereview
 *
 * Note: decideCorrection() is unchanged (Tier 2).
 */
export function decideTier3Correction(
  ctx: Tier3CorrectionContext,
): Tier3CorrectionDecision {
  const {
    per_fix_owner_count,
    max_per_fix_owner,
    max_total_per_cycle,
    issue_persistence,
    available_specialists,
    review_result,
    failed_specialist_ids,
    original_cards,
    correction_count,
  } = ctx;

  // 1. Total >= max → escalate
  const total = Object.values(per_fix_owner_count).reduce((sum, v) => sum + v, 0);
  if (total >= max_total_per_cycle) {
    return { disposition: "escalate", re_dispatch_cards: [] };
  }

  // 2 & 3. Any fix_owner at max?
  for (const ownerId of failed_specialist_ids) {
    const ownerCount = per_fix_owner_count[ownerId] ?? 0;
    if (ownerCount >= max_per_fix_owner) {
      // Find alternative
      const alts = (available_specialists ?? []).filter((s) => s !== ownerId);
      if (alts.length > 0) {
        // Reassign to first available alternative
        const reassign_to = alts[0];
        const re_dispatch_cards = original_cards
          .filter((c) => c.id === ownerId || c.id.startsWith(ownerId + "-"))
          .map((c) => ({
            ...c,
            id: reassign_to,
            dispatch_rev: c.dispatch_rev + 1,
            task: c.task.startsWith("[CORRECTION]") ? c.task : `[CORRECTION] ${c.task}`,
          }));
        return { disposition: "fix_and_rereview", re_dispatch_cards, reassign_to };
      } else {
        // No alt → escalate
        return { disposition: "escalate", re_dispatch_cards: [] };
      }
    }
  }

  // 4. Issue persistence >= 2 → escalate
  if (issue_persistence) {
    for (const [, count] of Object.entries(issue_persistence)) {
      if (count >= 2) {
        return { disposition: "escalate", re_dispatch_cards: [] };
      }
    }
  }

  // 5. No blocking issues → abort
  const hasBlocking = review_result.issues.some((i) => i.blocking);
  if (!hasBlocking) {
    return { disposition: "abort", re_dispatch_cards: [] };
  }

  // 6. fix_and_rereview
  const re_dispatch_cards = original_cards
    .filter((card) =>
      failed_specialist_ids.some(
        (failedId) => card.id === failedId || card.id.startsWith(failedId + "-"),
      ),
    )
    .map((card) => ({
      ...card,
      dispatch_rev: card.dispatch_rev + 1,
      task: card.task.startsWith("[CORRECTION]") ? card.task : `[CORRECTION] ${card.task}`,
    }));

  const reviewerTemplate = original_cards.find((c) => c.role === "reviewer");
  const reviewer_re_dispatch = reviewerTemplate
    ? {
        ...reviewerTemplate,
        dispatch_rev: reviewerTemplate.dispatch_rev + 1,
        task: reviewerTemplate.task.startsWith("[RE-REVIEW]")
          ? reviewerTemplate.task
          : `[RE-REVIEW] ${reviewerTemplate.task}`,
        input_refs: re_dispatch_cards.map((c) => c.id),
      }
    : undefined;

  return { disposition: "fix_and_rereview", re_dispatch_cards, reviewer_re_dispatch };
}
