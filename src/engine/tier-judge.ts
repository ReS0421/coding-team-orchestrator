import { Tier } from "../domain/types.js";

/**
 * Represents a shared surface that multiple specialists may read or write.
 *
 * A shared surface is any artifact (file, database, API contract, etc.) that
 * is accessed by more than one specialist in a task execution. Proper ownership
 * and controllability metadata is required for Tier 2 eligibility.
 *
 * @example
 * const surface: SharedSurface = {
 *   path: "src/domain/types.ts",
 *   rule: "append-only",
 *   owner: "planner",
 *   controllable: true,
 * };
 */
export interface SharedSurface {
  /** Relative path or identifier of the shared artifact (e.g., `"src/domain/types.ts"`). */
  path: string;
  /** Access rule governing how specialists may interact with this surface (e.g., `"append-only"`, `"read-only"`). */
  rule: string;
  /** Identifier of the specialist or role that owns (is responsible for) this surface. Must be non-empty for Tier 2. */
  owner: string;
  /**
   * Whether the orchestrator can control write ordering for this surface.
   * Defaults to `true`. Set to `false` if external forces (e.g., CI jobs, other agents)
   * may modify the surface outside orchestrator control — this forces Tier 3.
   */
  controllable?: boolean; // default true
}

/**
 * Input descriptor used by {@link judgeTier} to determine the appropriate execution tier.
 *
 * @example
 * const input: TierJudgeInput = {
 *   write_scope: ["src/index.ts", "src/app.ts"],
 *   shared_surfaces: [],
 *   specialist_count: 1,
 * };
 */
export interface TierJudgeInput {
  /**
   * List of file paths (or identifiers) that will be written during execution.
   * More than 20 entries triggers a Tier 3 guard regardless of other factors.
   */
  write_scope: string[];
  /**
   * Optional list of shared surfaces involved in this task.
   * If omitted, defaults to an empty array (no shared surfaces).
   */
  shared_surfaces?: SharedSurface[];
  /**
   * Number of specialist sub-agents to be spawned.
   * Defaults to `1` if omitted.
   * Values above 3 trigger Tier 3; values above 1 with shared surfaces promote to Tier 2.
   */
  specialist_count?: number;
}

/**
 * Determine the tier for a given request.
 *
 * 설계 §Tier 판정:
 * - Tier 1: no shared, specialist ≤ 1, write_scope ≤ 5
 * - Tier 2: shared ≤ 2 (모두 owner 지정 + controllable), specialist ≤ 3
 * - Tier 3: shared > 2 or uncontrollable or specialist > 3 → Tier 3 판정 시 반환
 *
 * 2차 기준 (보조): write_scope 20+ → Tier 3 가드
 *
 * @example
 * // Tier 1 result (simple, no shared surfaces)
 * const result: TierJudgeResult = { tier: 1 };
 *
 * // Tier 2 result (shared surfaces but all controlled)
 * const result: TierJudgeResult = { tier: 2 };
 *
 * // Tier 3 result (too many shared surfaces)
 * const result: TierJudgeResult = {
 *   tier: 3,
 *   reason: "3 shared surfaces exceed Tier 2 limit (max 2)",
 * };
 */
export interface TierJudgeResult {
  /** Numeric execution tier (1, 2, or 3) assigned to the request. */
  tier: Tier;
  /**
   * Human-readable explanation for why the tier was assigned.
   * Always present for Tier 3; omitted for Tier 1 and Tier 2 (implicit).
   */
  reason?: string;
}

/**
 * Judges the execution tier for a task based on its write scope, shared surfaces,
 * and specialist count.
 *
 * The tier determines the orchestration complexity:
 * - **Tier 1**: Single-specialist, isolated task. Minimal orchestration overhead.
 * - **Tier 2**: Multi-specialist task with a small number of fully controlled shared surfaces.
 * - **Tier 3**: High-complexity task requiring full orchestration (Execution Lead, rolling slots, shared owners).
 *
 * Tier 3 is assigned eagerly: any boundary violation short-circuits and returns immediately.
 * Tier 1 is assigned only when all three simplicity conditions hold simultaneously.
 * All remaining cases fall through to Tier 2.
 *
 * @param input - Descriptor of the task's write scope, shared surfaces, and specialist count.
 * @returns A {@link TierJudgeResult} containing the assigned tier and an optional reason string.
 *
 * @example
 * // Tier 1: isolated, single-specialist, small write scope
 * judgeTier({ write_scope: ["src/index.ts"], specialist_count: 1 });
 * // → { tier: 1 }
 *
 * @example
 * // Tier 2: two controlled shared surfaces
 * judgeTier({
 *   write_scope: ["src/a.ts", "src/b.ts"],
 *   shared_surfaces: [
 *     { path: "src/types.ts", rule: "append-only", owner: "planner" },
 *     { path: "src/config.ts", rule: "read-only", owner: "specialist-1" },
 *   ],
 *   specialist_count: 2,
 * });
 * // → { tier: 2 }
 *
 * @example
 * // Tier 3: uncontrollable shared surface
 * judgeTier({
 *   write_scope: ["src/a.ts"],
 *   shared_surfaces: [
 *     { path: "db/schema.sql", rule: "append-only", owner: "dba", controllable: false },
 *   ],
 * });
 * // → { tier: 3, reason: "Uncontrollable shared surfaces: db/schema.sql" }
 *
 * @example
 * // Tier 3: too many specialists
 * judgeTier({ write_scope: ["src/a.ts"], specialist_count: 4 });
 * // → { tier: 3, reason: "specialist_count 4 exceeds Tier 2 limit (max 3)" }
 */
export function judgeTier(input: TierJudgeInput): TierJudgeResult {
  const specialistCount = input.specialist_count ?? 1;
  const shared = input.shared_surfaces ?? [];
  const hasShared = shared.length > 0;

  // ── Tier 3 경계 가드 ──
  // shared 3개 이상
  if (shared.length > 2) {
    return {
      tier: 3,
      reason: `${shared.length} shared surfaces exceed Tier 2 limit (max 2)`,
    };
  }

  // controllable=false인 shared가 있으면 Tier 3
  const uncontrollable = shared.filter((s) => s.controllable === false);
  if (uncontrollable.length > 0) {
    return {
      tier: 3,
      reason: `Uncontrollable shared surfaces: ${uncontrollable.map((s) => s.path).join(", ")}`,
    };
  }

  // owner 미지정 shared가 있으면 Tier 3
  const noOwner = shared.filter((s) => !s.owner || s.owner.trim() === "");
  if (noOwner.length > 0) {
    return {
      tier: 3,
      reason: `Shared surfaces without owner: ${noOwner.map((s) => s.path).join(", ")}`,
    };
  }

  // specialist 4명 이상 → Tier 3
  if (specialistCount > 3) {
    return {
      tier: 3,
      reason: `specialist_count ${specialistCount} exceeds Tier 2 limit (max 3)`,
    };
  }

  // write_scope 20+ → Tier 3 가드 (보조 기준)
  if (input.write_scope.length > 20) {
    return {
      tier: 3,
      reason: `write_scope ${input.write_scope.length} exceeds Tier 2 limit (max 20)`,
    };
  }

  // ── Tier 1 ──
  if (!hasShared && specialistCount <= 1 && input.write_scope.length <= 5) {
    return { tier: 1 };
  }

  // ── Tier 2 ──
  return { tier: 2 };
}
