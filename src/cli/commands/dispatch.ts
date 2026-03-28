import { createEmptyManifest } from "../../store/manifest.js";
import { evaluateTier2DispatchRule, type TaskRequest } from "../../engine/dispatch-rule.js";
import { judgeTier } from "../../engine/tier-judge.js";
import type { Brief } from "../../schemas/brief.js";

export interface DispatchInput extends TaskRequest {
  brief: Brief;
}

export interface DispatchResult {
  tier: number;
  specialist_cards: unknown[];
  reviewer_card: unknown;
  has_shared: boolean;
  needs_planner: boolean;
}

export function runDispatch(input: DispatchInput): DispatchResult {
  const { tier } = judgeTier({
    write_scope: input.write_scope,
    shared_surfaces: input.shared_surfaces,
    specialist_count: input.brief.specialists.length,
  });

  const manifest = createEmptyManifest("cli");
  const result = evaluateTier2DispatchRule(manifest, input, input.brief);

  return {
    tier,
    specialist_cards: result.specialist_cards,
    reviewer_card: result.reviewer_card,
    has_shared: result.has_shared,
    needs_planner: result.needs_planner,
  };
}
