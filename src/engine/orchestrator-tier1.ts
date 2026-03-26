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

export const MANIFEST_FILE = "project-manifest.yaml";

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

export function makeErrorLog(
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

