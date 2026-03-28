import { judgeTier, type TierJudgeInput, type TierJudgeResult } from "../../engine/tier-judge.js";

export function runJudge(input: TierJudgeInput): TierJudgeResult {
  return judgeTier(input);
}
