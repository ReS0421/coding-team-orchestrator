import { randomUUID } from "node:crypto";
import type { ProjectManifest } from "../store/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import { findArtifact } from "../store/manifest.js";
import { judgeTier, type SharedSurface } from "./tier-judge.js";

export interface TaskRequest {
  task: string;
  write_scope: string[];
  input_refs?: string[];
  shared_surfaces?: SharedSurface[];
  scope_match?: boolean;       // openclaw semantic judgment — true if request fits current tasks_md scope
  replan_required?: boolean;   // explicit replan signal
}

export interface DispatchRuleResult {
  needs_planner: boolean;
  dispatch_card: DispatchCard;
  planner_card?: DispatchCard;
}

/**
 * Evaluate dispatch rules to determine if a planner is needed
 * and generate the appropriate dispatch card(s).
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

function checkNeedsPlanner(manifest: ProjectManifest, request: TaskRequest): boolean {
  const tasksMd = findArtifact(manifest, "tasks_md");
  if (!tasksMd) return true;
  if (tasksMd.lifecycle !== "approved") return true;
  if (tasksMd.freshness !== "fresh") return true; // 설계 §Dispatch Rule: freshness must be fresh

  // 설계 §Dispatch Rule: scope_match — openclaw semantic judgment, 불확실 시 false → planner spawn
  // TODO: 실제 semantic judgment는 Sprint 6 (real spawn) 시점에 구현
  const scopeMatch = request.scope_match ?? true; // stub: 미지정 시 true (fake runner 환경)
  if (!scopeMatch) return true;

  // 설계 §Dispatch Rule: replan_required — 명시적 replan 신호
  if (request.replan_required) return true;

  return false;
}
