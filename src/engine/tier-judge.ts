import { Tier } from "../domain/types.js";

export interface SharedSurface {
  path: string;
  rule: string;
  owner: string;
  controllable?: boolean; // default true
}

export interface TierJudgeInput {
  write_scope: string[];
  shared_surfaces?: SharedSurface[];
  specialist_count?: number;
}

/**
 * Determine the tier for a given request.
 *
 * 설계 §Tier 판정:
 * - Tier 1: no shared, specialist ≤ 1, write_scope ≤ 5
 * - Tier 2: shared ≤ 2 (모두 owner 지정 + controllable), specialist ≤ 3
 * - Tier 3: shared > 2 or uncontrollable or specialist > 3 → 미지원 에러
 *
 * 2차 기준 (보조): write_scope 20+ → Tier 3 가드
 */
export function judgeTier(input: TierJudgeInput): Tier {
  const specialistCount = input.specialist_count ?? 1;
  const shared = input.shared_surfaces ?? [];
  const hasShared = shared.length > 0;

  // ── Tier 3 경계 가드 ──
  // shared 3개 이상
  if (shared.length > 2) {
    throw new Error(
      `Tier 3 not supported yet: ${shared.length} shared surfaces exceed Tier 2 limit (max 2)`,
    );
  }

  // controllable=false인 shared가 있으면 Tier 3
  const uncontrollable = shared.filter((s) => s.controllable === false);
  if (uncontrollable.length > 0) {
    throw new Error(
      `Tier 3 not supported yet: uncontrollable shared surfaces [${uncontrollable.map((s) => s.path).join(", ")}]`,
    );
  }

  // owner 미지정 shared가 있으면 Tier 3
  const noOwner = shared.filter((s) => !s.owner || s.owner.trim() === "");
  if (noOwner.length > 0) {
    throw new Error(
      `Tier 3 not supported yet: shared surfaces without owner [${noOwner.map((s) => s.path).join(", ")}]`,
    );
  }

  // specialist 4명 이상 → Tier 3
  if (specialistCount > 3) {
    throw new Error(
      `Tier 3 not supported yet: specialist_count ${specialistCount} exceeds Tier 2 limit (max 3)`,
    );
  }

  // write_scope 20+ → Tier 3 가드 (보조 기준)
  if (input.write_scope.length > 20) {
    throw new Error(
      `Tier 3 not supported yet: write_scope ${input.write_scope.length} exceeds Tier 2 limit (max 20)`,
    );
  }

  // ── Tier 1 ──
  if (!hasShared && specialistCount <= 1 && input.write_scope.length <= 5) {
    return Tier.ONE;
  }

  // ── Tier 2 ──
  return Tier.TWO;
}
