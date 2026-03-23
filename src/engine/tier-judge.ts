import { Tier } from "../domain/types.js";

export interface SharedSurface {
  path: string;
  rule: string;
  owner: string;
}

export interface TierJudgeInput {
  write_scope: string[];
  shared_surfaces?: SharedSurface[];
  specialist_count?: number;
}

/**
 * Determine the tier for a given request.
 * Tier 1: no shared surfaces, specialist_count <= 1, write_scope <= 5
 * Otherwise Tier 2 (Tier 3 is stub — returns Tier 2)
 */
export function judgeTier(input: TierJudgeInput): Tier {
  const specialistCount = input.specialist_count ?? 1;
  const hasSharedSurfaces =
    input.shared_surfaces !== undefined && input.shared_surfaces.length > 0;

  if (!hasSharedSurfaces && specialistCount <= 1 && input.write_scope.length <= 5) {
    return Tier.ONE;
  }

  // TODO: Tier 3 판정 (Sprint 5)
  // 설계 §Tier 판정: shared surface 다수 or 아키텍처 판단 필요 or specialist 4+ → Tier 3
  // 현재는 Tier 2로 fallback
  return Tier.TWO;
}
