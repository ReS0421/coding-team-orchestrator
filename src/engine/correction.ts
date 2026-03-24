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
      ctx.failed_specialist_ids.some((failedId) => card.id.startsWith(failedId) || card.id === failedId),
    )
    .map((card) => ({
      ...card,
      dispatch_rev: card.dispatch_rev + 1,
      task: `[CORRECTION] ${card.task}`,
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
        task: `[RE-REVIEW] ${reviewerTemplate.task}`,
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
