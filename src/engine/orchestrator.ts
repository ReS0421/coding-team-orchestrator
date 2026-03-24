import * as fs from "node:fs";
import * as path from "node:path";
import { resolveError, type ErrorResolution } from "./error-resolution.js";
import type { RunnerFn } from "../runners/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import { safeValidateSpecialistSubmission } from "../schemas/specialist-submission.js";
import { safeValidatePlannerReturn, type PlannerReturn } from "../schemas/planner-return.js";
import type { Tier } from "../domain/types.js";
import type { ErrorLog } from "../schemas/error-log.js";
import {
  createEmptyManifest,
  loadManifest,
  saveManifest,
} from "../store/manifest.js";
import { appendEventLog, appendErrorLog } from "../store/log-writer.js";
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
  const tier = judgeTier({
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
        { event: "completed", session_id: sessionId, task: request.task, timestamp: new Date().toISOString() },
        { logDir: config.logDir },
      );

      return {
        success: true,
        tier,
        dispatch_card,
        specialist_result: specialistResult,
        planner_result: plannerResult,
        retry_count: retryCount,
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
import { runParallel } from "../runners/spawn-adapter.js";
import { evaluateTier2DispatchRule } from "./dispatch-rule.js";
import { decideCorrection } from "./correction.js";

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

  const tier = judgeTier({
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
    };
  }

  // ── Phase 1: PLANNING ──
  const {
    needs_planner,
    planner_card,
    specialist_cards,
    reviewer_card,
  } = evaluateTier2DispatchRule(manifest, request, request.brief);

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
      };
    }
  }

  // ── Phase 2: EXECUTION ──
  let currentCards = specialist_cards;
  let specialistResults = await runParallel(currentCards, config.runner);

  // Retry failed specialists (contained propagation)
  if (!specialistResults.all_succeeded) {
    const failedCards = currentCards.filter((c) =>
      specialistResults.failed_ids.includes(c.id),
    );
    if (failedCards.length > 0) {
      // Retry each failed card individually
      const retryResults = await runParallel(failedCards, config.runner);

      // Merge: replace failed entries with retry results
      const retryMap = new Map(retryResults.settled.map((s) => [s.id, s]));
      specialistResults = {
        settled: specialistResults.settled.map((s) =>
          retryMap.has(s.id) ? retryMap.get(s.id)! : s,
        ),
        all_succeeded: specialistResults.settled.every(
          (s) => (retryMap.has(s.id) ? retryMap.get(s.id)!.status === "fulfilled" : s.status === "fulfilled"),
        ),
        failed_ids: specialistResults.settled
          .filter((s) => {
            const final = retryMap.has(s.id) ? retryMap.get(s.id)! : s;
            return final.status === "rejected";
          })
          .map((s) => s.id),
      };
    }
  }

  // If still failed after retry → escalate
  if (!specialistResults.all_succeeded) {
    appendErrorLog(
      makeErrorLog(sessionId, "specialist", "crash", 1, 1, specialistResults.failed_ids,
        resolveError({ error_type: "crash", retry_count: 1, max_retries: maxRetries, correction_count: 0, max_corrections: maxCorrections, is_final_attempt: true })),
      { logDir: config.logDir },
    );
    return {
      success: false,
      tier: 2,
      phase: "execution",
      specialist_results: specialistResults,
      correction_count: 0,
      planner_result: plannerResult,
      error: `Specialists failed: ${specialistResults.failed_ids.join(", ")}`,
    };
  }

  // Validate specialist submissions
  for (const s of specialistResults.settled) {
    if (s.value) {
      const validation = safeValidateSpecialistSubmission(s.value);
      if (!validation.success) {
        return {
          success: false,
          tier: 2,
          phase: "execution",
          specialist_results: specialistResults,
          correction_count: 0,
          planner_result: plannerResult,
          error: `Specialist ${s.id} returned malformed data`,
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
      };
    }

    // PASS → done
    if (reviewResult.disposition_recommendation === "PASS") {
      appendEventLog(
        { event: "completed", session_id: sessionId, task: request.task, timestamp: new Date().toISOString() },
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
      };
    }

    // fix_and_rereview
    correctionCount++;

    // Re-execute failed specialists
    if (correction.re_dispatch_cards.length > 0) {
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
