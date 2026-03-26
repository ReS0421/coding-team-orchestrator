import { randomUUID } from "node:crypto";
import type { ProjectManifest } from "../store/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { Brief } from "../schemas/brief.js";
import { findArtifact } from "../store/manifest.js";
import { judgeTier, type SharedSurface } from "./tier-judge.js";
import { identifySharedOwner } from "./shared-protocol.js";
import { selectActingLead, applyActingLeadToCards } from "./acting-lead.js";

/**
 * Represents a single task dispatch request, including the task description,
 * write scope, optional input references, and metadata about shared surfaces
 * or replanning requirements.
 *
 * @example
 * ```ts
 * const request: TaskRequest = {
 *   task: "Implement feature X",
 *   write_scope: ["src/feature.ts", "src/utils.ts"],
 *   input_refs: ["spec.md"],
 *   shared_surfaces: [{ path: "src/shared.ts", rule: "tier2_shared_protocol", owner: "spec-a" }],
 *   scope_match: true,
 *   replan_required: false,
 * };
 * ```
 */
export interface TaskRequest {
  /** Human-readable description of the task to execute. */
  task: string;
  /** File paths that the dispatched agent is allowed to write to. */
  write_scope: string[];
  /**
   * Optional IDs of artifacts or cards that provide input context
   * for the dispatched agent.
   */
  input_refs?: string[];
  /**
   * Optional list of shared surfaces (files/paths accessed by multiple specialists).
   * Used by `tier-judge` to determine the dispatch tier.
   */
  shared_surfaces?: SharedSurface[];
  /**
   * Whether the current `tasks_md` artifact's scope matches this request.
   * Defaults to `true` when omitted. Setting to `false` forces replanning.
   */
  scope_match?: boolean;
  /**
   * When `true`, forces planner re-execution regardless of `tasks_md` state.
   * Useful when the task scope has fundamentally changed since last planning.
   */
  replan_required?: boolean;
}

/**
 * Return value of {@link evaluateDispatchRule} (Tier 1).
 *
 * Contains the primary specialist dispatch card and optionally a planner card
 * when the orchestrator determines that planning is required before execution.
 *
 * @example
 * ```ts
 * const result: DispatchRuleResult = evaluateDispatchRule(manifest, request);
 * if (result.needs_planner) {
 *   // spawn planner first, then specialist
 *   spawnAgent(result.planner_card!);
 * }
 * spawnAgent(result.dispatch_card);
 * ```
 */
export interface DispatchRuleResult {
  /**
   * `true` if a planner agent must run before the specialist.
   * When `true`, `planner_card` is always present.
   */
  needs_planner: boolean;
  /** The specialist dispatch card to execute the task. */
  dispatch_card: DispatchCard;
  /**
   * Optional planner dispatch card. Present only when `needs_planner` is `true`.
   * The planner must produce an approved `tasks.md` before the specialist starts.
   */
  planner_card?: DispatchCard;
}

// ─── Tier 2 dispatch result ─────────────────────────────

/**
 * Return value of {@link evaluateTier2DispatchRule}.
 *
 * Encapsulates the full set of dispatch cards for a Tier 2 multi-specialist
 * execution: one card per specialist, one reviewer card, and optionally a
 * planner card. Also carries shared-surface coordination metadata.
 *
 * @example
 * ```ts
 * const result: Tier2DispatchResult = evaluateTier2DispatchRule(manifest, request, brief);
 * if (result.needs_planner) {
 *   spawnAgent(result.planner_card!);
 * }
 * for (const card of result.specialist_cards) {
 *   spawnAgent(card);
 * }
 * spawnAgent(result.reviewer_card);
 * ```
 */
export interface Tier2DispatchResult {
  /**
   * `true` if a planner must run before specialists.
   * When `true`, `planner_card` is always defined.
   */
  needs_planner: boolean;
  /**
   * Optional planner dispatch card. Present when `needs_planner` is `true`.
   */
  planner_card?: DispatchCard;
  /**
   * One dispatch card per specialist defined in the {@link Brief}.
   * Cards may carry shared-surface coordination fields (`spawn_order`,
   * `is_shared_owner`, `selective_hold`, `is_acting_lead`) when applicable.
   */
  specialist_cards: DispatchCard[];
  /**
   * Reviewer dispatch card. The reviewer runs after all specialists complete,
   * using their card IDs as `input_refs` for cross-checking.
   */
  reviewer_card: DispatchCard;
  /**
   * ID of the specialist designated as acting lead when the brief contains
   * shared surfaces and multi-agent coordination is required.
   * `undefined` when no acting lead is needed.
   *
   * @remarks Sprint 3 addition.
   */
  acting_lead_id?: string;
  /**
   * `true` when the brief contains at least one shared surface path.
   * Drives shared-protocol field injection into specialist cards.
   */
  has_shared: boolean;
  /**
   * `true` when a manifest-lite document must be generated before specialist
   * dispatch. Triggered by shared surfaces, acting lead presence, or 3+ specialists.
   */
  manifest_lite_required: boolean;
}

// ─── Tier 1 (unchanged) ────────────────────────────────

/**
 * Evaluates dispatch rules for a **Tier 1** task request and returns a
 * {@link DispatchRuleResult} containing a specialist card and, when needed,
 * a planner card.
 *
 * ### Planner necessity rules (all evaluated via {@link checkNeedsPlanner}):
 * 1. No `tasks_md` artifact exists in the manifest → planner required.
 * 2. `tasks_md` lifecycle is not `"approved"` → planner required.
 * 3. `tasks_md` freshness is not `"fresh"` → planner required.
 * 4. `request.scope_match` is explicitly `false` → planner required.
 * 5. `request.replan_required` is `true` → planner required.
 *
 * @param manifest - The current project manifest containing tracked artifacts.
 * @param request  - The task dispatch request including scope and metadata.
 * @returns A {@link DispatchRuleResult} with a specialist card and optional planner card.
 *
 * @example
 * ```ts
 * const manifest = manifestWithApprovedTasks();
 * const request: TaskRequest = {
 *   task: "Refactor auth module",
 *   write_scope: ["src/auth/index.ts"],
 * };
 *
 * const result = evaluateDispatchRule(manifest, request);
 * // result.needs_planner === false (tasks_md is approved and fresh)
 * // result.dispatch_card.role === "specialist"
 * // result.planner_card === undefined
 * ```
 */
export function evaluateDispatchRule(
  manifest: ProjectManifest,
  request: TaskRequest,
): DispatchRuleResult {
  const needsPlanner = checkNeedsPlanner(manifest, request);
  const { tier } = judgeTier({
    write_scope: request.write_scope,
    shared_surfaces: request.shared_surfaces,
  });

  const uid = randomUUID().slice(0, 8);

  const specialistCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id: `specialist-${uid}`,
    tier,
    task: request.task,
    input_refs: request.input_refs ?? [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: request.write_scope,
    completion_check: ["tests pass"],
    return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };

  if (!needsPlanner) {
    return { needs_planner: false, dispatch_card: specialistCard };
  }

  const plannerCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "planner",
    id: `planner-${uid}`,
    tier,
    task: request.task,
    input_refs: request.input_refs ?? [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: request.write_scope,
    completion_check: ["tasks_md generated"],
    return_format: { schema: "planner_return_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };

  return {
    needs_planner: true,
    dispatch_card: specialistCard,
    planner_card: plannerCard,
  };
}

// ─── Tier 2 ─────────────────────────────────────────────

/**
 * Evaluates dispatch rules for a **Tier 2** task request involving multiple
 * specialists, and returns a {@link Tier2DispatchResult} with per-specialist
 * cards, a reviewer card, and optional planner card.
 *
 * ### Card generation logic:
 * - One specialist card is created per entry in `brief.specialists`.
 * - When shared surfaces exist (`brief.shared.length > 0`):
 *   - The shared owner specialist receives `is_shared_owner: true`,
 *     `spawn_order: 1`, and a `priority_task` describing the shared paths.
 *   - Consumer specialists receive `selective_hold: true` and `spawn_order: 2`.
 * - {@link selectActingLead} and {@link applyActingLeadToCards} inject
 *   `is_acting_lead` into the appropriate specialist card when coordination
 *   requires a lead.
 * - `manifest_lite_required` is `true` when: shared surfaces exist,
 *   an acting lead is needed, or there are 3+ specialists.
 *
 * @param manifest - The current project manifest containing tracked artifacts.
 * @param request  - The task dispatch request including scope and metadata.
 * @param brief    - The decomposition brief listing specialists, shared paths,
 *                   and acceptance checks for the Tier 2 task.
 * @returns A {@link Tier2DispatchResult} with all cards and coordination metadata.
 *
 * @example
 * ```ts
 * const brief: Brief = {
 *   specialists: [
 *     { id: "spec-a", scope: ["src/auth.ts"], owns: ["src/shared-types.ts"] },
 *     { id: "spec-b", scope: ["src/api.ts"],  owns: [] },
 *   ],
 *   shared: ["src/shared-types.ts"],
 *   accept_checks: ["tests pass", "lint clean"],
 * };
 *
 * const result = evaluateTier2DispatchRule(manifest, request, brief);
 * // result.has_shared === true
 * // result.specialist_cards[0].is_shared_owner === true
 * // result.specialist_cards[1].selective_hold === true
 * // result.reviewer_card.role === "reviewer"
 * ```
 */
export function evaluateTier2DispatchRule(
  manifest: ProjectManifest,
  request: TaskRequest,
  brief: Brief,
): Tier2DispatchResult {
  const needsPlanner = checkNeedsPlanner(manifest, request);
  const uid = randomUUID().slice(0, 8);
  const hasShared = brief.shared.length > 0;

  // Shared owner + acting lead
  let sharedOwnerId: string | undefined;
  let sharedPaths: string[] = [];
  if (hasShared) {
    const ownerInfo = identifySharedOwner(brief);
    sharedOwnerId = ownerInfo.ownerId;
    sharedPaths = ownerInfo.sharedPaths;
  }
  const leadDecision = selectActingLead(brief, sharedOwnerId);

  // manifest-lite required: shared || acting_lead || 3 specialists
  const manifest_lite_required =
    hasShared ||
    leadDecision.needs_acting_lead ||
    brief.specialists.length >= 3;

  // Shared surface mapping from brief
  const sharedSurfaces: {
    path: string;
    rule: string;
    owner: string;
    controllable?: boolean;
  }[] = brief.shared.map((sharedPath) => {
    const owner = brief.specialists.find((s) => s.owns.includes(sharedPath));
    return {
      path: sharedPath,
      rule: "tier2_shared_protocol",
      owner: owner?.id ?? brief.specialists[0].id,
      controllable: true,
    };
  });

  // Specialist cards — one per brief specialist
  let specialist_cards: DispatchCard[] = brief.specialists.map((spec) => {
    const isOwner = hasShared && spec.id === sharedOwnerId;
    const card: DispatchCard = {
      version: 1 as const,
      dispatch_rev: 1,
      role: "specialist" as const,
      id: `${spec.id}-${uid}`,
      tier: 2 as const,
      task: `${request.task} — scope: ${spec.scope.join(", ")}`,
      input_refs: request.input_refs ?? [],
      entrypoint: [],
      must_read: [],
      authoritative_artifact: [],
      write_scope: spec.scope,
      ...(sharedSurfaces.length > 0 ? { shared_surface: sharedSurfaces } : {}),
      completion_check: brief.accept_checks,
      return_format: { schema: "specialist_submission_v1" },
      timeout_profile: {
        class: "standard" as const,
        heartbeat_required: false,
      },
      // Shared protocol fields
      ...(isOwner
        ? {
            is_shared_owner: true,
            spawn_order: 1,
            priority_task: `Implement shared interface changes first: ${sharedPaths.join(", ")}`,
          }
        : {}),
      ...(hasShared && !isOwner
        ? {
            selective_hold: true,
            spawn_order: 2,
          }
        : {}),
    };
    return card;
  });

  // Apply acting lead to cards
  specialist_cards = applyActingLeadToCards(specialist_cards, leadDecision);

  // Reviewer card
  const reviewer_card: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "reviewer",
    id: `reviewer-${uid}`,
    tier: 2,
    task: `Review: ${request.task}`,
    input_refs: specialist_cards.map((c) => c.id),
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [],
    completion_check: ["spec check", "quality check", "cross check"],
    return_format: { schema: "reviewer_return_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };

  // Planner card (if needed)
  let planner_card: DispatchCard | undefined;
  if (needsPlanner) {
    planner_card = {
      version: 1,
      dispatch_rev: 1,
      role: "planner",
      id: `planner-${uid}`,
      tier: 2,
      task: request.task,
      input_refs: request.input_refs ?? [],
      entrypoint: [],
      must_read: [],
      authoritative_artifact: [],
      write_scope: request.write_scope,
      completion_check: ["tasks_md generated", "brief generated"],
      return_format: { schema: "planner_return_v1" },
      timeout_profile: { class: "standard", heartbeat_required: false },
    };
  }

  return {
    needs_planner: needsPlanner,
    planner_card,
    specialist_cards,
    reviewer_card,
    acting_lead_id: leadDecision.acting_lead_id,
    has_shared: hasShared,
    manifest_lite_required,
  };
}

// ─── Shared helpers ─────────────────────────────────────

/**
 * Determines whether a planner agent is required before dispatching a specialist.
 *
 * Returns `true` (planner needed) when ANY of the following conditions hold:
 * 1. No `tasks_md` artifact is registered in the manifest.
 * 2. The `tasks_md` artifact's `lifecycle` is not `"approved"`.
 * 3. The `tasks_md` artifact's `freshness` is not `"fresh"`.
 * 4. `request.scope_match` is explicitly `false` (defaults to `true` when omitted).
 * 5. `request.replan_required` is `true`.
 *
 * @param manifest - The current project manifest to inspect for `tasks_md`.
 * @param request  - The task request containing scope and replanning hints.
 * @returns `true` if a planner must run before the specialist; `false` otherwise.
 *
 * @example
 * ```ts
 * // Internal usage within evaluateDispatchRule / evaluateTier2DispatchRule:
 * const needsPlanner = checkNeedsPlanner(manifest, { task: "...", write_scope: [...] });
 * // → true if tasks_md is missing, stale, or scope changed
 * ```
 */
function checkNeedsPlanner(
  manifest: ProjectManifest,
  request: TaskRequest,
): boolean {
  const tasksMd = findArtifact(manifest, "tasks_md");
  if (!tasksMd) return true;
  if (tasksMd.lifecycle !== "approved") return true;
  if (tasksMd.freshness !== "fresh") return true;

  const scopeMatch = request.scope_match ?? true;
  if (!scopeMatch) return true;

  if (request.replan_required) return true;

  return false;
}
