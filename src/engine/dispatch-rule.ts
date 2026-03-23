import type { ProjectManifest } from "../store/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import { findArtifact } from "../store/manifest.js";
import { judgeTier, type SharedSurface } from "./tier-judge.js";

export interface TaskRequest {
  task: string;
  write_scope: string[];
  input_refs?: string[];
  shared_surfaces?: SharedSurface[];
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
  const needsPlanner = checkNeedsPlanner(manifest);
  const tier = judgeTier({
    write_scope: request.write_scope,
    shared_surfaces: request.shared_surfaces,
  });

  const now = Date.now();

  const specialistCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id: `specialist-${now}`,
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
    id: `planner-${now}`,
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

function checkNeedsPlanner(manifest: ProjectManifest): boolean {
  const tasksMd = findArtifact(manifest, "tasks_md");
  if (!tasksMd) return true;
  if (tasksMd.lifecycle !== "approved") return true;
  if (tasksMd.freshness === "stale_hard") return true;
  return false;
}
