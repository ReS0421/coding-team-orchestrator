import type { Brief } from "../schemas/brief.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";

// ─── Types ──────────────────────────────────────────────

export interface ActingLeadDecision {
  needs_acting_lead: boolean;
  acting_lead_id?: string;
  dispatch_owner: "openclaw" | "acting_lead";
  merge_owner: "openclaw" | "acting_lead";
}

// ─── Acting lead selection ──────────────────────────────

/**
 * Select acting lead based on design §Acting Lead Rule:
 *   specialist ≤ 2, shared 없음 → none, openclaw
 *   specialist ≤ 2, shared 있음 → shared owner, acting_lead
 *   specialist == 3 → required (shared owner or first specialist fallback)
 */
export function selectActingLead(
  brief: Brief,
  sharedOwner?: string,
): ActingLeadDecision {
  const count = brief.specialists.length;
  const hasShared = brief.shared.length > 0;

  // specialist ≤ 2, no shared → no acting lead
  if (count <= 2 && !hasShared) {
    return {
      needs_acting_lead: false,
      dispatch_owner: "openclaw",
      merge_owner: "openclaw",
    };
  }

  // specialist ≤ 2, shared → shared owner is acting lead
  if (count <= 2 && hasShared) {
    return {
      needs_acting_lead: true,
      acting_lead_id: sharedOwner ?? brief.specialists[0].id,
      dispatch_owner: "acting_lead",
      merge_owner: "acting_lead",
    };
  }

  // specialist 3+ → acting lead required
  return {
    needs_acting_lead: true,
    acting_lead_id: sharedOwner ?? brief.specialists[0].id,
    dispatch_owner: "acting_lead",
    merge_owner: "acting_lead",
  };
}

// ─── Apply acting lead to cards ─────────────────────────

/**
 * Set is_acting_lead=true on the card matching the acting lead decision.
 * Returns new array (does not mutate).
 */
export function applyActingLeadToCards(
  cards: DispatchCard[],
  decision: ActingLeadDecision,
): DispatchCard[] {
  if (!decision.needs_acting_lead || !decision.acting_lead_id) {
    return cards;
  }

  return cards.map((card) => {
    if (card.id.startsWith(decision.acting_lead_id!)) {
      return { ...card, is_acting_lead: true };
    }
    return card;
  });
}
