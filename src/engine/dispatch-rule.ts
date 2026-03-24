import { randomUUID } from "node:crypto";
import type { ProjectManifest } from "../store/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { Brief } from "../schemas/brief.js";
import { findArtifact } from "../store/manifest.js";
import { judgeTier, type SharedSurface } from "./tier-judge.js";

export interface TaskRequest {
  task: string;
  write_scope: string[];
  input_refs?: string[];
  shared_surfaces?: SharedSurface[];
  scope_match?: boolean;
  replan_required?: boolean;
}

export interface DispatchRuleResult {
  needs_planner: boolean;
  dispatch_card: DispatchCard;
  planner_card?: DispatchCard;
}

// ─── Tier 2 dispatch result ─────────────────────────────

export interface Tier2DispatchResult {
  needs_planner: boolean;
  planner_card?: DispatchCard;
  specialist_cards: DispatchCard[];
  reviewer_card: DispatchCard;
}

// ─── Tier 1 (unchanged) ────────────────────────────────

/**
 * Evaluate dispatch rules for Tier 1.
 */
export function evaluateDispatchRule(
  manifest: ProjectManifest,
  request: TaskRequest,
): DispatchRuleResult {
  const needsPlanner = checkNeedsPlanner(manifest, request);
  const tier = judgeTier({
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
 * Evaluate dispatch rules for Tier 2.
 * Generates one dispatch card per specialist + one reviewer card.
 */
export function evaluateTier2DispatchRule(
  manifest: ProjectManifest,
  request: TaskRequest,
  brief: Brief,
): Tier2DispatchResult {
  const needsPlanner = checkNeedsPlanner(manifest, request);
  const uid = randomUUID().slice(0, 8);

  // Shared surface mapping from brief
  const sharedSurfaces: { path: string; rule: string; owner: string }[] =
    brief.shared.map((sharedPath) => {
      // Find the specialist that owns this shared path (first match)
      const owner = brief.specialists.find((s) =>
        s.owns.includes(sharedPath),
      );
      return {
        path: sharedPath,
        rule: "tier2_shared_protocol",
        owner: owner?.id ?? brief.specialists[0].id,
      };
    });

  // Specialist cards — one per brief specialist
  const specialist_cards: DispatchCard[] = brief.specialists.map((spec, idx) => ({
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
    ...(spec.owns.length > 0
      ? {}
      : {}),
    ...(sharedSurfaces.length > 0
      ? { shared_surface: sharedSurfaces }
      : {}),
    completion_check: brief.accept_checks,
    return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard" as const, heartbeat_required: false },
  }));

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
    completion_check: [
      "spec check",
      "quality check",
      "cross check",
    ],
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
  };
}

// ─── Shared helpers ─────────────────────────────────────

function checkNeedsPlanner(manifest: ProjectManifest, request: TaskRequest): boolean {
  const tasksMd = findArtifact(manifest, "tasks_md");
  if (!tasksMd) return true;
  if (tasksMd.lifecycle !== "approved") return true;
  if (tasksMd.freshness !== "fresh") return true;

  const scopeMatch = request.scope_match ?? true;
  if (!scopeMatch) return true;

  if (request.replan_required) return true;

  return false;
}
