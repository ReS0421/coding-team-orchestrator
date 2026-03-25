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
import { createCheckpointForPhase, findCheckpointByPhase } from "../store/checkpoint.js";
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
      error: "Tier 2/3 not supported yet",
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
      const patchSet = buildPatchSetFromSubmission(submission, manifest);
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
      };
    }

    // Merge owner + consumer results
    specialistResults = {
      settled: [...sharedResult.owner_results.settled, ...sharedResult.consumer_results.settled],
      all_succeeded: sharedResult.all_succeeded,
      failed_ids: sharedResult.failed_ids,
    };

    if (!specialistResults.all_succeeded) {
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
      return {
        success: false, tier: 2, phase: "execution",
        specialist_results: specialistResults, correction_count: 0, planner_result: plannerResult,
        error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
        shared_changes: 0, acting_lead_id: leadDecision.acting_lead_id, tier3_escalation: false,
        manifest_lite_seq: manifestLiteSeq,
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
      return {
        success: false, tier: 2, phase: "execution",
        specialist_results: specialistResults, correction_count: 0, planner_result: plannerResult,
        error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
        shared_changes: 0, tier3_escalation: false,
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
      };
    }

    // Re-execute failed specialists
    {
      const correctionResults = await runParallel(correction.re_dispatch_cards, config.runner);

      // Update specialist results with correction results
      const correctionMap = new Map(correctionResults.settled.map((s) => [s.id, s]));
      for (const cs of correctionResults.settled) {
        // Add or replace in settled
        const existingIdx = specialistResults.settled.findIndex((s) => s.id === cs.id);
        if (existingIdx >= 0) {
          specialistResults.settled[existingIdx] = cs;
        } else {
          specialistResults.settled.push(cs);
        }
      }
      // Recalculate
      specialistResults.all_succeeded = specialistResults.settled.every((s) => s.status === "fulfilled");
      specialistResults.failed_ids = specialistResults.settled.filter((s) => s.status === "rejected").map((s) => s.id);
    }

    // Update reviewer card for next round
    if (correction.reviewer_re_dispatch) {
      currentReviewerCard = correction.reviewer_re_dispatch;
    }
  }
}
