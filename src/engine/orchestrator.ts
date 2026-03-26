import * as fs from "node:fs";
import * as path from "node:path";
import { resolveError, type ErrorResolution } from "./error-resolution.js";
import type { RunnerFn } from "../runners/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import { safeValidateSpecialistSubmission, type SpecialistSubmission } from "../schemas/specialist-submission.js";
import { safeValidatePlannerReturn, type PlannerReturn } from "../schemas/planner-return.js";
import type { Tier } from "../domain/types.js";
import type { ErrorLog } from "../schemas/error-log.js";
import {
  createEmptyManifest,
  loadManifest,
  saveManifest,
} from "../store/manifest.js";
import { buildPatchSetFromSubmission, buildCombinedPatchSet } from "./patch-builder.js";
import { applyPatchSetFull } from "../store/patch-engine.js";
import { createCheckpointForPhase, findCheckpointByPhase, restoreFromCheckpoint } from "../store/checkpoint.js";
import { appendEventLog, appendErrorLog } from "../store/log-writer.js";
import type { EventLogEntry } from "../schemas/event-log.js";
import { evaluateDispatchRule, type TaskRequest } from "./dispatch-rule.js";
import { judgeTier } from "./tier-judge.js";

export interface OrchestratorConfig {
  projectRoot: string;
  logDir: string;
  runner: RunnerFn;
  maxRetries?: number;
}

export interface OrchestratorResult {
  success: boolean;
  tier: Tier;
  dispatch_card: DispatchCard;
  specialist_result?: SpecialistSubmission;
  planner_result?: PlannerReturn;
  retry_count: number;
  error?: string;
  final_manifest_seq?: number;
}

const MANIFEST_FILE = "project-manifest.yaml";

/**
 * Run a Tier 1 orchestration flow.
 */
export async function runTier1(
  config: OrchestratorConfig,
  request: TaskRequest,
): Promise<OrchestratorResult> {
  const maxRetries = config.maxRetries ?? 1;
  const sessionId = `session-${Date.now()}`;

  // ── INTAKE ──
  let manifest;
  const manifestPath = path.resolve(config.projectRoot, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    manifest = loadManifest(config.projectRoot);
  } else {
    manifest = createEmptyManifest("orchestrator");
  }
  saveManifest(config.projectRoot, manifest);

  // ── TIER_JUDGE ──
  const { tier } = judgeTier({
    write_scope: request.write_scope,
    shared_surfaces: request.shared_surfaces,
  });

  if (tier !== 1) {
    const dummyCard = evaluateDispatchRule(manifest, request).dispatch_card;
    return {
      success: false,
      tier,
      dispatch_card: dummyCard,
      retry_count: 0,
      error: "Tier 2+ not handled by runTier1",
    };
  }

  // ── DISPATCH ──
  const { needs_planner, dispatch_card, planner_card } = evaluateDispatchRule(
    manifest,
    request,
  );

  // ── PLANNER (optional) ──
  let plannerResult: PlannerReturn | undefined;
  if (needs_planner && planner_card) {
    try {
      const raw = await config.runner(planner_card);
      const validation = safeValidatePlannerReturn(raw);
      if (!validation.success) {
        const resolution = resolveError({
          error_type: "malformed_return",
          retry_count: 0,
          max_retries: maxRetries,
          correction_count: 0,
          max_corrections: 2,
          is_final_attempt: true,
        });
        appendErrorLog(
          makeErrorLog(sessionId, "planner", "malformed_return", 1, 0, [request.task], resolution),
          { logDir: config.logDir },
        );
        return {
          success: false,
          tier,
          dispatch_card,
          retry_count: 0,
          error: "Planner returned malformed data",
        };
      }
      plannerResult = validation.data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const resolution = resolveError({
        error_type: "crash",
        retry_count: 0,
        max_retries: maxRetries,
        correction_count: 0,
        max_corrections: 2,
        is_final_attempt: true,
      });
      appendErrorLog(
        makeErrorLog(sessionId, "planner", "crash", 1, 0, [request.task], resolution, errMsg),
        { logDir: config.logDir },
      );
      return {
        success: false,
        tier,
        dispatch_card,
        retry_count: 0,
        error: `Planner failed: ${errMsg}`,
      };
    }
  }

  // ── SPECIALIST (with retry) ──
  let retryCount = 0;
  let specialistResult: SpecialistSubmission | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isFinalAttempt = attempt === maxRetries;

    try {
      const raw = await config.runner(dispatch_card);
      const validation = safeValidateSpecialistSubmission(raw);

      if (!validation.success) {
        const resolution = resolveError({
          error_type: "malformed_return",
          retry_count: retryCount,
          max_retries: maxRetries,
          correction_count: 0,
          max_corrections: 2,
          is_final_attempt: isFinalAttempt,
        });
        appendErrorLog(
          makeErrorLog(sessionId, "specialist", "malformed_return", dispatch_card.dispatch_rev, retryCount, [request.task], resolution),
          { logDir: config.logDir },
        );
        if (attempt < maxRetries) {
          retryCount++;
          continue;
        }
        return {
          success: false,
          tier,
          dispatch_card,
          planner_result: plannerResult,
          retry_count: retryCount,
          error: "Specialist returned malformed data",
        };
      }

      const submission = validation.data;

      // ── VALIDATE evidence ──
      if (!submission.evidence.build_pass || !submission.evidence.test_pass) {
        const resolution = resolveError({
          error_type: "silent_failure",
          retry_count: retryCount,
          max_retries: maxRetries,
          correction_count: 0,
          max_corrections: 2,
          is_final_attempt: isFinalAttempt,
        });
        appendErrorLog(
          makeErrorLog(sessionId, "specialist", "silent_failure", dispatch_card.dispatch_rev, retryCount, [request.task], resolution),
          { logDir: config.logDir },
        );
        if (attempt < maxRetries) {
          retryCount++;
          continue;
        }
        return {
          success: false,
          tier,
          dispatch_card,
          specialist_result: submission,
          planner_result: plannerResult,
          retry_count: retryCount,
          error: "Evidence check failed",
        };
      }

      // ── SUCCESS ──
      specialistResult = submission;
      appendEventLog(
        { ts: new Date().toISOString(), event: "completed", session_id: sessionId, task: request.task } as EventLogEntry,
        { logDir: config.logDir },
      );

      // ── MANIFEST INTEGRATION ──
      const patchSet = buildPatchSetFromSubmission(submission, manifest, undefined, dispatch_card.id);
      if (patchSet) {
        const fullResult = applyPatchSetFull(manifest, patchSet);
        if (fullResult.success) {
          manifest = fullResult.manifest;
        }
      }
      manifest = createCheckpointForPhase(manifest, "done");
      saveManifest(config.projectRoot, manifest);

      return {
        success: true,
        tier,
        dispatch_card,
        specialist_result: specialistResult,
        planner_result: plannerResult,
        retry_count: retryCount,
        final_manifest_seq: manifest.manifest_seq,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const resolution = resolveError({
        error_type: "crash",
        retry_count: retryCount,
        max_retries: maxRetries,
        correction_count: 0,
        max_corrections: 2,
        is_final_attempt: isFinalAttempt,
      });
      appendErrorLog(
        makeErrorLog(sessionId, "specialist", "crash", dispatch_card.dispatch_rev, retryCount, [request.task], resolution, errMsg),
        { logDir: config.logDir },
      );
      if (attempt < maxRetries) {
        retryCount++;
        continue;
      }
      return {
        success: false,
        tier,
        dispatch_card,
        planner_result: plannerResult,
        retry_count: retryCount,
        error: `Specialist crashed: ${errMsg}`,
      };
    }
  }

  return {
    success: false,
    tier,
    dispatch_card,
    retry_count: retryCount,
    error: "Unexpected orchestrator state",
  };
}

function makeErrorLog(
  sessionId: string,
  role: ErrorLog["role"],
  errorType: ErrorLog["error_type"],
  dispatchRev: number,
  retryCount: number,
  affectedTasks: string[],
  resolution: ErrorResolution,
  notes?: string,
): ErrorLog {
  return {
    session_id: sessionId,
    role,
    error_type: errorType,
    timestamp: new Date().toISOString(),
    dispatch_rev: dispatchRev,
    retry_count: retryCount,
    propagation_class: "contained",
    affected_tasks: affectedTasks,
    artifact_refs: [],
    resolution,
    notes,
  };
}

// ─── Tier 2 ─────────────────────────────────────────────

import type { Brief } from "../schemas/brief.js";
import type { Phase } from "../domain/types.js";
import type { ReviewerReturn } from "../schemas/reviewer-return.js";
import { safeValidateReviewerReturn } from "../schemas/reviewer-return.js";
import type { ParallelResult } from "../runners/types.js";
import { runParallel, runSharedExecution } from "../runners/spawn-adapter.js";
import { evaluateTier2DispatchRule } from "./dispatch-rule.js";
import { decideCorrection } from "./correction.js";
import { identifySharedOwner, handleUnexpectedSharedChange, type SharedChangeHistory } from "./shared-protocol.js";
import { selectActingLead } from "./acting-lead.js";
import { createEmptyManifestLite, saveManifestLite } from "../store/manifest-lite.js";

export interface Tier2Config extends OrchestratorConfig {
  maxCorrections?: number;
}

export interface Tier2Request extends TaskRequest {
  brief: Brief;
}

export interface Tier2Result {
  success: boolean;
  tier: 2;
  phase: Phase;
  specialist_results: ParallelResult;
  review_result?: ReviewerReturn;
  correction_count: number;
  planner_result?: PlannerReturn;
  error?: string;
  // Sprint 3: shared fields
  shared_changes: number;
  acting_lead_id?: string;
  tier3_escalation?: boolean;
  manifest_lite_seq?: number;
  // Sprint 4: manifest integration
  final_manifest_seq?: number;
  checkpoints_created?: string[];
}


// ── Helper: retry failed specialists ──
async function retryFailedSpecialists(
  results: ParallelResult,
  cards: DispatchCard[],
  runner: RunnerFn,
): Promise<ParallelResult> {
  if (results.all_succeeded) return results;
  const failedCards = cards.filter((c) => results.failed_ids.includes(c.id));
  if (failedCards.length === 0) return results;

  const retryResults = await runParallel(failedCards, runner);
  const retryMap = new Map(retryResults.settled.map((s) => [s.id, s]));
  const settled = results.settled.map((s) => retryMap.has(s.id) ? retryMap.get(s.id)! : s);
  return {
    settled,
    all_succeeded: settled.every((s) => s.status === "fulfilled"),
    failed_ids: settled.filter((s) => s.status === "rejected").map((s) => s.id),
  };
}

export async function runTier2(
  config: Tier2Config,
  request: Tier2Request,
): Promise<Tier2Result> {
  const maxRetries = config.maxRetries ?? 1;
  const maxCorrections = config.maxCorrections ?? 2;
  const sessionId = `session-${Date.now()}`;

  const emptyParallel: ParallelResult = { settled: [], all_succeeded: true, failed_ids: [] };

  // ── Phase 0: INTAKE ──
  const manifestPath = path.resolve(config.projectRoot, MANIFEST_FILE);
  let manifest;
  if (fs.existsSync(manifestPath)) {
    manifest = loadManifest(config.projectRoot);
  } else {
    manifest = createEmptyManifest("orchestrator");
  }
  saveManifest(config.projectRoot, manifest);

  const { tier } = judgeTier({
    write_scope: request.write_scope,
    shared_surfaces: request.shared_surfaces,
    specialist_count: request.brief.specialists.length,
  });

  if (tier !== 2) {
    return {
      success: false,
      tier: 2,
      phase: "failed",
      specialist_results: emptyParallel,
      correction_count: 0,
      error: `Expected Tier 2 but got Tier ${tier}`,
      shared_changes: 0,
      tier3_escalation: false,
    };
  }

  // ── Phase 1: PLANNING ──
  const dispatchResult = evaluateTier2DispatchRule(manifest, request, request.brief);
  const {
    needs_planner,
    planner_card,
    specialist_cards,
    reviewer_card,
  } = dispatchResult;

  let plannerResult: PlannerReturn | undefined;
  if (needs_planner && planner_card) {
    try {
      const raw = await config.runner(planner_card);
      const validation = safeValidatePlannerReturn(raw);
      if (!validation.success) {
        return {
          success: false,
          tier: 2,
          phase: "planning",
          specialist_results: emptyParallel,
          correction_count: 0,
          error: "Planner returned malformed data",
          shared_changes: 0,
          tier3_escalation: false,
        };
      }
      plannerResult = validation.data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        tier: 2,
        phase: "planning",
        specialist_results: emptyParallel,
        correction_count: 0,
        error: `Planner failed: ${errMsg}`,
        shared_changes: 0,
        tier3_escalation: false,
      };
    }
  }

  // ── Checkpoint: cp-execution (after planning success) ──
  const checkpointsCreated: string[] = [];
  manifest = createCheckpointForPhase(manifest, "execution");
  checkpointsCreated.push("cp-execution");
  saveManifest(config.projectRoot, manifest);

  // ── Phase 2: EXECUTION (3-branch) ──
  let specialistResults: ParallelResult = emptyParallel;
  let currentCards = specialist_cards;

  const hasShared = request.brief.shared.length > 0;
  const sharedOwnerId = hasShared
    ? identifySharedOwner(request.brief).ownerId
    : undefined;
  const leadDecision = selectActingLead(request.brief, sharedOwnerId);

  let sharedChanges = 0;
  let tier3Escalation = false;
  let manifestLiteSeq: number | undefined;

  if (hasShared) {
    // ── Branch A: Shared execution path ──
    appendEventLog(
      { ts: new Date().toISOString(), event: "acting_lead_assigned", session_id: sessionId, role: leadDecision.acting_lead_id } as EventLogEntry,
      { logDir: config.logDir },
    );

    // Manifest-lite
    if (dispatchResult.manifest_lite_required) {
      const manifestLite = createEmptyManifestLite(request.brief.brief_id);
      saveManifestLite(config.projectRoot, manifestLite);
      manifestLiteSeq = 0;
    }

    const ownerCards = specialist_cards.filter((c) => c.is_shared_owner);
    const consumerCards = specialist_cards.filter((c) => !c.is_shared_owner);

    const sharedHistory: SharedChangeHistory = {
      total_shared_changes: 0,
      consumer_blocked_count: 0,
      undiscovered_shared_surfaces: [],
    };

    const sharedResult = await runSharedExecution({
      ownerCards,
      consumerCards,
      runner: config.runner,
      onOwnerComplete: () => {
        appendEventLog(
          { ts: new Date().toISOString(), event: "owner_commit", session_id: sessionId } as EventLogEntry,
          { logDir: config.logDir },
        );
      },
      onConsumerBlocked: (blocked, ctx) => {
        const sub = ctx.submission;
        // Check for undiscovered shared surfaces
        if (sub.blocked_on?.surface && !request.brief.shared.includes(sub.blocked_on.surface)) {
          sharedHistory.undiscovered_shared_surfaces.push(sub.blocked_on.surface);
        }
        sharedHistory.consumer_blocked_count++;
        sharedHistory.total_shared_changes = ctx.shared_change_count;

        const action = handleUnexpectedSharedChange(sub, request.brief, sharedHistory);

        if (action.action === "redispatch_owner") {
          appendEventLog(
            { ts: new Date().toISOString(), event: "shared_redispatch", session_id: sessionId } as EventLogEntry,
            { logDir: config.logDir },
          );
          return "redispatch_owner";
        }
        if (action.action === "escalate_tier3") {
          appendErrorLog(
            makeErrorLog(sessionId, "specialist", "blocked", 1, 0, [blocked.id], "tier3_escalation", action.reason),
            { logDir: config.logDir },
          );
          appendEventLog(
            { ts: new Date().toISOString(), event: "tier3_escalation", session_id: sessionId, reason: action.reason } as EventLogEntry,
            { logDir: config.logDir },
          );
          return "escalate_tier3";
        }
        return "retry";
      },
    });

    sharedChanges = sharedResult.shared_changes;
    tier3Escalation = sharedResult.tier3_escalation;

    if (tier3Escalation) {
      // Rollback to cp-execution checkpoint before returning
      const execCp = findCheckpointByPhase(manifest, "execution");
      if (execCp) {
        manifest = restoreFromCheckpoint(manifest, execCp.checkpoint_id, "Tier 3 escalation");
        saveManifest(config.projectRoot, manifest);
      }
      return {
        success: false,
        tier: 2,
        phase: "failed",
        specialist_results: sharedResult.consumer_results,
        correction_count: 0,
        planner_result: plannerResult,
        error: "Tier 3 escalation triggered",
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: true,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    // Merge owner + consumer results
    specialistResults = {
      settled: [...sharedResult.owner_results.settled, ...sharedResult.consumer_results.settled],
      all_succeeded: sharedResult.all_succeeded,
      failed_ids: sharedResult.failed_ids,
    };

    if (!specialistResults.all_succeeded) {
      // Rollback to cp-execution checkpoint
      const execCp = findCheckpointByPhase(manifest, "execution");
      if (execCp) {
        manifest = restoreFromCheckpoint(manifest, execCp.checkpoint_id, "Branch A specialist failure");
        saveManifest(config.projectRoot, manifest);
      }
      return {
        success: false,
        tier: 2,
        phase: "execution",
        specialist_results: specialistResults,
        correction_count: 0,
        planner_result: plannerResult,
        error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    // Update manifest-lite seq
    if (manifestLiteSeq !== undefined) {
      manifestLiteSeq++;
    }

  } else if (leadDecision.needs_acting_lead) {
    // ── Branch B: Shared-free + acting lead (specialist 3+) ──
    appendEventLog(
      { ts: new Date().toISOString(), event: "acting_lead_assigned", session_id: sessionId, role: leadDecision.acting_lead_id } as EventLogEntry,
      { logDir: config.logDir },
    );

    if (dispatchResult.manifest_lite_required) {
      const manifestLite = createEmptyManifestLite(request.brief.brief_id);
      saveManifestLite(config.projectRoot, manifestLite);
      manifestLiteSeq = 0;
    }

    // Standard parallel execution (no owner/consumer split)
    specialistResults = await runParallel(currentCards, config.runner);

    // Retry failed
    specialistResults = await retryFailedSpecialists(specialistResults, currentCards, config.runner);

    if (!specialistResults.all_succeeded) {
      appendErrorLog(
        makeErrorLog(sessionId, "specialist", "crash", 1, 1, specialistResults.failed_ids,
          resolveError({ error_type: "crash", retry_count: 1, max_retries: maxRetries, correction_count: 0, max_corrections: maxCorrections, is_final_attempt: true })),
        { logDir: config.logDir },
      );
      // Rollback to cp-execution checkpoint
      const execCpB = findCheckpointByPhase(manifest, "execution");
      if (execCpB) {
        manifest = restoreFromCheckpoint(manifest, execCpB.checkpoint_id, "Branch B specialist failure");
        saveManifest(config.projectRoot, manifest);
      }
      return {
        success: false, tier: 2, phase: "execution",
        specialist_results: specialistResults, correction_count: 0, planner_result: plannerResult,
        error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
        shared_changes: 0, acting_lead_id: leadDecision.acting_lead_id, tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

  } else {
    // ── Branch C: Existing shared-free path ──
    specialistResults = await runParallel(currentCards, config.runner);

    // Retry failed specialists (contained propagation)
    specialistResults = await retryFailedSpecialists(specialistResults, currentCards, config.runner);

    if (!specialistResults.all_succeeded) {
      appendErrorLog(
        makeErrorLog(sessionId, "specialist", "crash", 1, 1, specialistResults.failed_ids,
          resolveError({ error_type: "crash", retry_count: 1, max_retries: maxRetries, correction_count: 0, max_corrections: maxCorrections, is_final_attempt: true })),
        { logDir: config.logDir },
      );
      // Rollback to cp-execution checkpoint
      const execCpC = findCheckpointByPhase(manifest, "execution");
      if (execCpC) {
        manifest = restoreFromCheckpoint(manifest, execCpC.checkpoint_id, "Branch C specialist failure");
        saveManifest(config.projectRoot, manifest);
      }
      return {
        success: false, tier: 2, phase: "execution",
        specialist_results: specialistResults, correction_count: 0, planner_result: plannerResult,
        error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
        shared_changes: 0, tier3_escalation: false,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }
  }

  // Validate specialist submissions (all branches)
  for (const s of specialistResults.settled) {
    if (s.value) {
      const validation = safeValidateSpecialistSubmission(s.value);
      if (!validation.success) {
        return {
          success: false, tier: 2, phase: "execution",
          specialist_results: specialistResults, correction_count: 0, planner_result: plannerResult,
          error: `Specialist ${s.id} returned malformed data`,
          shared_changes: sharedChanges, acting_lead_id: leadDecision.acting_lead_id,
          tier3_escalation: false, manifest_lite_seq: manifestLiteSeq,
        };
      }
    }
  }

  // ── Task 4.11: Combined specialist commit ──
  {
    const allSubmissions: import("../schemas/specialist-submission.js").SpecialistSubmission[] = [];
    const allSpecialistIds: string[] = [];
    for (const s of specialistResults.settled) {
      if (s.status === "fulfilled" && s.value) {
        const v = safeValidateSpecialistSubmission(s.value);
        if (v.success) {
          allSubmissions.push(v.data);
          allSpecialistIds.push(s.id);
        }
      }
    }
    const combinedPatchSet = buildCombinedPatchSet(allSubmissions, manifest, undefined, allSpecialistIds);
    if (combinedPatchSet) {
      const fullResult = applyPatchSetFull(manifest, combinedPatchSet);
      if (fullResult.success) {
        manifest = fullResult.manifest;
      }
    }
  }

  // ── Checkpoint: cp-review (after all specialists succeed) ──
  manifest = createCheckpointForPhase(manifest, "review");
  checkpointsCreated.push("cp-review");
  saveManifest(config.projectRoot, manifest);

  // ── Phase 3 + Correction Loop ──
  let correctionCount = 0;
  let currentReviewerCard = reviewer_card;

  while (true) {
    // Review
    let reviewResult: ReviewerReturn;
    try {
      const raw = await config.runner(currentReviewerCard);
      const validation = safeValidateReviewerReturn(raw);
      if (!validation.success) {
        return {
          success: false,
          tier: 2,
          phase: "review",
          specialist_results: specialistResults,
          correction_count: correctionCount,
          planner_result: plannerResult,
          error: "Reviewer returned malformed data",
          shared_changes: sharedChanges,
          acting_lead_id: leadDecision.acting_lead_id,
          tier3_escalation: false,
          manifest_lite_seq: manifestLiteSeq,
        };
      }
      reviewResult = validation.data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        tier: 2,
        phase: "review",
        specialist_results: specialistResults,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: `Reviewer failed: ${errMsg}`,
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
      };
    }

    // PASS → done
    if (reviewResult.disposition_recommendation === "PASS") {
      appendEventLog(
        { ts: new Date().toISOString(), event: "completed", session_id: sessionId, task: request.task } as EventLogEntry,
        { logDir: config.logDir },
      );

      // ── Checkpoint: cp-done (reviewer PASS) ──
      manifest = createCheckpointForPhase(manifest, "done");
      checkpointsCreated.push("cp-done");
      saveManifest(config.projectRoot, manifest);

      return {
        success: true,
        tier: 2,
        phase: "done",
        specialist_results: specialistResults,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    // FAIL → correction
    const blockingIssues = reviewResult.issues.filter((i) => i.blocking);
    const failedSpecialistIds = [
      ...new Set(
        blockingIssues
          .map((i) => i.fix_owner)
          .filter((owner): owner is string => !!owner),
      ),
    ];

    // If no fix_owner specified, use first specialist
    const correctionFailedIds = failedSpecialistIds.length > 0
      ? failedSpecialistIds
      : [currentCards[0]?.id ?? "unknown"];

    const correction = decideCorrection({
      review_result: reviewResult,
      failed_specialist_ids: correctionFailedIds,
      original_cards: [...currentCards, currentReviewerCard],
      brief: request.brief,
      correction_count: correctionCount,
      max_corrections: maxCorrections,
    });

    if (correction.disposition === "escalate") {
      // ── Task 4.12: Escalation rollback ──
      const execCp = findCheckpointByPhase(manifest, "execution");
      if (execCp) {
        manifest = restoreFromCheckpoint(manifest, execCp.checkpoint_id, "escalation rollback");
        saveManifest(config.projectRoot, manifest);
      }
      return {
        success: false,
        tier: 2,
        phase: "failed",
        specialist_results: specialistResults,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: "Correction limit exceeded — escalation required",
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    if (correction.disposition === "abort") {
      return {
        success: false,
        tier: 2,
        phase: "failed",
        specialist_results: specialistResults,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: "Correction aborted — no blocking issues",
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
      };
    }

    // fix_and_rereview
    correctionCount++;

    // Guard: if fix_and_rereview but no cards to re-dispatch → escalate to avoid infinite loop
    if (correction.re_dispatch_cards.length === 0) {
      appendErrorLog(
        makeErrorLog(sessionId, "reviewer", "stalled", correctionCount, maxCorrections, [],
          "escalate"),
        { logDir: config.logDir },
      );
      return {
        success: false, tier: 2, phase: "correction",
        specialist_results: specialistResults, correction_count: correctionCount,
        planner_result: plannerResult,
        error: "Correction requested fix_and_rereview but produced no re-dispatch cards — escalating",
        shared_changes: sharedChanges,
        acting_lead_id: leadDecision.acting_lead_id,
        tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    // ── Task 4.12: Correction rollback → re-execute → re-commit ──
    // 1. Rollback to execution checkpoint
    const execCpForCorrection = findCheckpointByPhase(manifest, "execution");
    if (execCpForCorrection) {
      manifest = restoreFromCheckpoint(manifest, execCpForCorrection.checkpoint_id, "correction rollback");
    }

    // 2. Re-execute correction specialists
    {
      const correctionResults = await runParallel(correction.re_dispatch_cards, config.runner);

      // Update specialist results with correction results
      for (const cs of correctionResults.settled) {
        const existingIdx = specialistResults.settled.findIndex((s) => s.id === cs.id);
        if (existingIdx >= 0) {
          specialistResults.settled[existingIdx] = cs;
        } else {
          specialistResults.settled.push(cs);
        }
      }
      specialistResults.all_succeeded = specialistResults.settled.every((s) => s.status === "fulfilled");
      specialistResults.failed_ids = specialistResults.settled.filter((s) => s.status === "rejected").map((s) => s.id);
    }

    // 3. Re-commit ALL submissions (existing success + correction results)
    {
      const allSubmissions: import("../schemas/specialist-submission.js").SpecialistSubmission[] = [];
      const allSpecialistIds: string[] = [];
      for (const s of specialistResults.settled) {
        if (s.status === "fulfilled" && s.value) {
          const v = safeValidateSpecialistSubmission(s.value);
          if (v.success) {
            allSubmissions.push(v.data);
            allSpecialistIds.push(s.id);
          }
        }
      }
      const combinedPatchSet = buildCombinedPatchSet(allSubmissions, manifest, undefined, allSpecialistIds);
      if (combinedPatchSet) {
        const fullResult = applyPatchSetFull(manifest, combinedPatchSet);
        if (fullResult.success) {
          manifest = fullResult.manifest;
        }
      }
      saveManifest(config.projectRoot, manifest);
    }

    // Update reviewer card for next round
    if (correction.reviewer_re_dispatch) {
      currentReviewerCard = correction.reviewer_re_dispatch;
    }
  }
}

// ─── Tier 3 ─────────────────────────────────────────────

import type { ExecutionContract } from "../schemas/execution-contract.js";
import { safeValidateLeadReturn, type LeadReturn } from "../schemas/lead-return.js";
import { runDualReview, type DualReviewResult } from "./dual-reviewer.js";
import { decideTier3Correction, type Tier3CorrectionContext } from "./correction.js";
import { planLeadRecovery, type LeadCrashContext } from "./lead-recovery.js";
import { createHeartbeatState, diagnoseLeadStatus, checkHeartbeat } from "./heartbeat.js";
import { terminateAllOwners, type SharedOwnerSession } from "./shared-owner-lifecycle.js";
import { SharedOwnerState } from "../domain/types.js";

export interface Tier3Config extends Tier2Config {
  maxLeadRetries?: number; // default 1
  onIntegrationTest?: () => boolean; // default: returns true
  /** Phase 1 gate: provisional approval after planner completes. Default: () => true */
  onProvisionalApproval?: () => boolean;
  /** Phase 1→2 gate: execution approval after lead returns execution contract. Default: () => true */
  onExecutionApproval?: (contract: import("../schemas/execution-contract.js").ExecutionContract) => boolean;
}

export interface Tier3Result {
  success: boolean;
  tier: 3;
  phase: Phase;
  lead_result?: LeadReturn;
  review_result?: DualReviewResult;
  correction_count: number;
  planner_result?: PlannerReturn;
  error?: string;
  final_manifest_seq?: number;
  checkpoints_created?: string[];
  lead_crash_count?: number;
  integration_retry_count?: number;
}

export async function runTier3(
  config: Tier3Config,
  request: Tier2Request,
): Promise<Tier3Result> {
  const maxLeadRetries = config.maxLeadRetries ?? 1;
  const maxCorrections = config.maxCorrections ?? 4;
  const sessionId = `session-tier3-${Date.now()}`;
  const onIntegrationTest = config.onIntegrationTest ?? (() => true);

  const emptyParallel: ParallelResult = { settled: [], all_succeeded: true, failed_ids: [] };
  const checkpointsCreated: string[] = [];
  let correctionCount = 0;
  let leadCrashCount = 0;
  let integrationRetryCount = 0;

  // ── Phase 0: INTAKE ──
  const manifestPath = path.resolve(config.projectRoot, MANIFEST_FILE);
  let manifest: import("../store/types.js").ProjectManifest;
  if (fs.existsSync(manifestPath)) {
    manifest = loadManifest(config.projectRoot);
  } else {
    manifest = createEmptyManifest("orchestrator");
  }
  saveManifest(config.projectRoot, manifest);

  // ── TIER JUDGE ──
  const { tier } = judgeTier({
    write_scope: request.write_scope,
    shared_surfaces: request.shared_surfaces,
    specialist_count: request.brief.specialists.length,
  });

  if (tier !== 3) {
    return {
      success: false,
      tier: 3,
      phase: "failed",
      correction_count: 0,
      error: `Expected Tier 3 but got Tier ${tier}`,
      lead_crash_count: 0,
      integration_retry_count: 0,
    };
  }

  // ── Phase 1: PLANNING (optional) ──
  const dispatchResult = evaluateTier2DispatchRule(manifest, request, request.brief);
  let plannerResult: PlannerReturn | undefined;

  if (dispatchResult.needs_planner && dispatchResult.planner_card) {
    try {
      const raw = await config.runner(dispatchResult.planner_card);
      const validation = safeValidatePlannerReturn(raw);
      if (!validation.success) {
        return {
          success: false,
          tier: 3,
          phase: "planning",
          correction_count: 0,
          error: "Planner returned malformed data",
          lead_crash_count: 0,
          integration_retry_count: 0,
        };
      }
      plannerResult = validation.data;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        tier: 3,
        phase: "planning",
        correction_count: 0,
        error: `Planner failed: ${errMsg}`,
        lead_crash_count: 0,
        integration_retry_count: 0,
      };
    }
  }

  // ── Provisional approval gate (1단계: 방향성 OK) ──
  const provisionalApproval = config.onProvisionalApproval ?? (() => true);
  if (!provisionalApproval()) {
    return {
      success: false,
      tier: 3,
      phase: "planning",
      correction_count: 0,
      error: "Provisional approval rejected",
      lead_crash_count: 0,
      integration_retry_count: 0,
    };
  }

  // ── Build lead dispatch card ──
  const uid = `lead-${Date.now()}`;
  const leadCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "execution_lead",
    id: uid,
    tier: 3,
    task: `Tier 3 execution lead for brief: ${request.brief.brief_id}`,
    input_refs: [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: request.write_scope,
    completion_check: ["all specialists done", "merge candidate ready"],
    return_format: { schema: "lead_return_v1" },
    timeout_profile: { class: "extended", heartbeat_required: true },
    active_span: 3,
    specialist_assignments: request.brief.specialists.map((s, i) => ({
      specialist_id: s.id,
      task: `Implement ${s.scope.join(", ")}`,
      shared_owner: false,
      priority: i + 1,
    })),
  };

  // Build spec/quality reviewer cards
  const specReviewerCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "reviewer",
    id: `spec-reviewer-${uid}`,
    tier: 3,
    task: `[SPEC REVIEW] Tier 3 spec review for brief: ${request.brief.brief_id}`,
    input_refs: [uid],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [],
    completion_check: ["spec check", "contract adherence"],
    return_format: { schema: "reviewer_return_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };

  const qualityReviewerCard: DispatchCard = {
    version: 1,
    dispatch_rev: 1,
    role: "reviewer",
    id: `quality-reviewer-${uid}`,
    tier: 3,
    task: `[QUALITY REVIEW] Tier 3 quality review for brief: ${request.brief.brief_id}`,
    input_refs: [uid],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [],
    completion_check: ["quality check", "best practices"],
    return_format: { schema: "reviewer_return_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };

  // Checkpoint after planning
  manifest = createCheckpointForPhase(manifest, "execution");
  checkpointsCreated.push("cp-execution");
  saveManifest(config.projectRoot, manifest);

  // Track per-fix-owner correction counts for Tier 3 budget
  const perFixOwnerCount: Record<string, number> = {};

  // ── Phase 2: EXECUTION (lead-driven, crash-recovery loop) ──
  let leadCrashCtx: { completed: import("../schemas/specialist-submission.js").SpecialistSubmission[]; pending: string[] } = {
    completed: [],
    pending: request.brief.specialists.map((s) => s.id),
  };
  let executionContract: ExecutionContract | undefined;
  let leadResult: LeadReturn | undefined;
  let sharedOwnerSessions: SharedOwnerSession[] = [];

  const executePhase2 = async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const raw = await config.runner(leadCard);
      const validation = safeValidateLeadReturn(raw);
      if (!validation.success) {
        return { success: false, error: "Lead returned malformed data" };
      }

      leadResult = validation.data;
      executionContract = leadResult.execution_contract;

      // ── Execution approval gate (2단계: 실행 확정) ──
      if (executionContract) {
        const executionApproval = config.onExecutionApproval ?? (() => true);
        if (!executionApproval(executionContract)) {
          return { success: false, error: "Execution approval rejected" };
        }
      }

      // Apply manifest updates from lead
      if (leadResult.manifest_updates) {
        const fullResult = applyPatchSetFull(manifest, leadResult.manifest_updates);
        if (fullResult.success) {
          manifest = fullResult.manifest;
        }
      }

      // Checkpoint execution result
      manifest = createCheckpointForPhase(manifest, "review");
      checkpointsCreated.push("cp-review");
      saveManifest(config.projectRoot, manifest);

      // Handle shared_owner_states from lead
      if (leadResult.shared_owner_states) {
        // Build sessions from lead result
        sharedOwnerSessions = Object.entries(leadResult.shared_owner_states).map(
          ([ownerId, state], idx) => ({
            owner_id: ownerId,
            surface: ownerId,
            state: state as SharedOwnerState,
            spawn_order: idx + 1,
          }),
        );
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  // Phase 2 execution with crash recovery
  let phase2Success = false;
  for (let attempt = 0; attempt <= maxLeadRetries; attempt++) {
    const result = await executePhase2();

    if (result.success) {
      phase2Success = true;
      break;
    }

    // Lead crashed or malformed or approval rejected
    // If malformed or approval rejected (not a crash), return error immediately
    if (result.error === "Lead returned malformed data" || result.error === "Execution approval rejected") {
      return {
        success: false,
        tier: 3,
        phase: "execution",
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: result.error,
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
      };
    }

    leadCrashCount++;
    const heartbeat = checkHeartbeat(
      createHeartbeatState(0),
      { interval_ms: 100, stale_threshold_ms: 100 },
      Date.now(),
    );
    const diagnosis = diagnoseLeadStatus(heartbeat, false);

    if (diagnosis === "crash") {
      const crashCtx: LeadCrashContext = {
        completed_specialist_results: leadCrashCtx.completed,
        pending_specialist_ids: leadCrashCtx.pending,
        original_cards: dispatchResult.specialist_cards,
        execution_contract: executionContract ?? {
          contract_id: `contract-${uid}`,
          brief_id: request.brief.brief_id,
          specialist_assignments: request.brief.specialists.map((s, i) => ({
            specialist_id: s.id,
            task: `Implement ${s.scope.join(", ")}`,
            shared_owner: false,
            priority: i + 1,
          })),
          shared_surfaces: [],
          active_span: 3,
        },
        manifest_at_phase2_entry: manifest,
      };

      const recoveryPlan = planLeadRecovery(crashCtx, attempt, maxLeadRetries);

      if (recoveryPlan.strategy === "escalate") {
        return {
          success: false,
          tier: 3,
          phase: "failed",
          correction_count: correctionCount,
          planner_result: plannerResult,
          error: `Lead escalated: ${recoveryPlan.reason}`,
          lead_crash_count: leadCrashCount,
          integration_retry_count: integrationRetryCount,
          final_manifest_seq: manifest.manifest_seq,
          checkpoints_created: checkpointsCreated,
        };
      }

      // Continue loop for respawn/restart
      continue;
    }

    return {
      success: false,
      tier: 3,
      phase: "execution",
      correction_count: correctionCount,
      planner_result: plannerResult,
      error: result.error,
      lead_crash_count: leadCrashCount,
      integration_retry_count: integrationRetryCount,
    };
  }

  if (!phase2Success) {
    return {
      success: false,
      tier: 3,
      phase: "execution",
      correction_count: correctionCount,
      planner_result: plannerResult,
      error: "Lead execution failed after all retries",
      lead_crash_count: leadCrashCount,
      integration_retry_count: integrationRetryCount,
    };
  }

  // ── Phase 3: DUAL REVIEW + CORRECTION LOOP ──
  let currentSpecReviewerCard = specReviewerCard;
  let currentQualityReviewerCard = qualityReviewerCard;
  let reviewResult: DualReviewResult | undefined;

  while (true) {
    try {
      reviewResult = await runDualReview({
        spec_reviewer_card: currentSpecReviewerCard,
        quality_reviewer_card: currentQualityReviewerCard,
        runner: config.runner,
      });
    } catch (err) {
      return {
        success: false,
        tier: 3,
        phase: "review",
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: `Dual review failed: ${err instanceof Error ? err.message : String(err)}`,
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
      };
    }

    if (reviewResult.disposition === "PASS") {
      break;
    }

    // FAIL → decide correction
    const blockingIssues = reviewResult.merged_issues.filter((i) => i.blocking);
    const failedOwnerIds = [...new Set(
      blockingIssues.map((i) => i.fix_owner).filter((o): o is string => !!o),
    )];

    if (failedOwnerIds.length === 0) {
      // No fix_owner → abort, treat as PASS
      break;
    }

    // Update per-fix-owner counts
    for (const ownerId of failedOwnerIds) {
      perFixOwnerCount[ownerId] = (perFixOwnerCount[ownerId] ?? 0) + 1;
    }

    const tier3Ctx: Tier3CorrectionContext = {
      review_result: reviewResult.spec_review, // use spec review for base
      failed_specialist_ids: failedOwnerIds,
      original_cards: dispatchResult.specialist_cards,
      brief: request.brief,
      correction_count: correctionCount,
      max_corrections: maxCorrections,
      per_fix_owner_count: perFixOwnerCount,
      max_per_fix_owner: 2,
      max_total_per_cycle: 4,
    };

    const correction = decideTier3Correction(tier3Ctx);

    if (correction.disposition === "escalate") {
      return {
        success: false,
        tier: 3,
        phase: "correction",
        lead_result: leadResult,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: "Tier 3 correction budget exceeded — escalation required",
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    if (correction.disposition === "abort") {
      break;
    }

    correctionCount++;

    // Re-run lead for corrections
    if (correction.re_dispatch_cards.length > 0) {
      for (const corrCard of correction.re_dispatch_cards) {
        try {
          await config.runner(corrCard);
        } catch {
          // ignore correction runner errors
        }
      }
    }

    // Update reviewer cards for re-review
    if (correction.reviewer_re_dispatch) {
      currentSpecReviewerCard = {
        ...currentSpecReviewerCard,
        dispatch_rev: currentSpecReviewerCard.dispatch_rev + 1,
        task: currentSpecReviewerCard.task,
      };
      currentQualityReviewerCard = {
        ...currentQualityReviewerCard,
        dispatch_rev: currentQualityReviewerCard.dispatch_rev + 1,
        task: currentQualityReviewerCard.task,
      };
    }
  }

  // ── Phase 4: INTEGRATION TEST ──
  while (true) {
    if (!leadResult?.final_merge_candidate) {
      return {
        success: false,
        tier: 3,
        phase: "review",
        lead_result: leadResult,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: "No final merge candidate from lead",
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    const integrationPassed = onIntegrationTest();

    if (integrationPassed) {
      break;
    }

    // Integration test failed → back to Phase 2
    integrationRetryCount++;
    correctionCount++;

    const retryPhase2 = await executePhase2();
    if (!retryPhase2.success) {
      return {
        success: false,
        tier: 3,
        phase: "execution",
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: `Phase 2 retry failed after integration test failure: ${retryPhase2.error}`,
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }

    // Re-run dual review
    try {
      reviewResult = await runDualReview({
        spec_reviewer_card: currentSpecReviewerCard,
        quality_reviewer_card: currentQualityReviewerCard,
        runner: config.runner,
      });
    } catch (err) {
      return {
        success: false,
        tier: 3,
        phase: "review",
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: `Post-integration review failed: ${err instanceof Error ? err.message : String(err)}`,
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
      };
    }

    if (reviewResult.disposition === "FAIL") {
      return {
        success: false,
        tier: 3,
        phase: "review",
        lead_result: leadResult,
        review_result: reviewResult,
        correction_count: correctionCount,
        planner_result: plannerResult,
        error: "Review failed after integration test retry",
        lead_crash_count: leadCrashCount,
        integration_retry_count: integrationRetryCount,
        final_manifest_seq: manifest.manifest_seq,
        checkpoints_created: checkpointsCreated,
      };
    }
  }

  // ── Phase 5: SHUTDOWN ──
  // Terminate all shared owners
  if (sharedOwnerSessions.length > 0) {
    sharedOwnerSessions = terminateAllOwners(sharedOwnerSessions);
  }

  // Verify all owners are TERMINATED
  const allTerminated = sharedOwnerSessions.every(
    (s) => s.state === SharedOwnerState.TERMINATED,
  );

  // cp-done checkpoint
  manifest = createCheckpointForPhase(manifest, "done");
  checkpointsCreated.push("cp-done");
  saveManifest(config.projectRoot, manifest);

  return {
    success: true,
    tier: 3,
    phase: "done",
    lead_result: leadResult,
    review_result: reviewResult,
    correction_count: correctionCount,
    planner_result: plannerResult,
    final_manifest_seq: manifest.manifest_seq,
    checkpoints_created: checkpointsCreated,
    lead_crash_count: leadCrashCount,
    integration_retry_count: integrationRetryCount,
  };
}
