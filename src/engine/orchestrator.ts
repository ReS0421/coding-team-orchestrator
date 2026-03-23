import * as fs from "node:fs";
import * as path from "node:path";
import type { RunnerFn } from "../../tests/helpers/fake-runner.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import { safeValidateSpecialistSubmission } from "../schemas/specialist-submission.js";
import type { PlannerReturn } from "../schemas/planner-return.js";
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
  const maxRetries = config.maxRetries ?? 2;
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
      plannerResult = raw as PlannerReturn;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendErrorLog(
        makeErrorLog(sessionId, "planner", "crash", 1, 0, [request.task]),
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
    try {
      const raw = await config.runner(dispatch_card);
      const validation = safeValidateSpecialistSubmission(raw);

      if (!validation.success) {
        // Malformed return
        appendErrorLog(
          makeErrorLog(sessionId, "specialist", "malformed_return", dispatch_card.dispatch_rev, retryCount, [request.task]),
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
        appendErrorLog(
          makeErrorLog(sessionId, "specialist", "silent_failure", dispatch_card.dispatch_rev, retryCount, [request.task]),
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
      appendErrorLog(
        makeErrorLog(sessionId, "specialist", "crash", dispatch_card.dispatch_rev, retryCount, [request.task], errMsg),
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

  // Should not reach here, but satisfy TypeScript
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
    resolution: "retry",
    notes,
  };
}
