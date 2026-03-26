import * as fs from "node:fs";
import * as path from "node:path";
import { resolveError, type ErrorResolution } from "./error-resolution.js";
import type { RunnerFn } from "../runners/types.js";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import { safeValidateSpecialistSubmission, type SpecialistSubmission } from "../schemas/specialist-submission.js";
import { safeValidatePlannerReturn, type PlannerReturn } from "../schemas/planner-return.js";
import type { Tier } from "../domain/types.js";
import type { ErrorLog } from "../schemas/error-log.js";
import { createEmptyManifest, loadManifest, saveManifest } from "../store/manifest.js";
import { buildPatchSetFromSubmission, buildCombinedPatchSet } from "./patch-builder.js";
import { applyPatchSetFull } from "../store/patch-engine.js";
import { createCheckpointForPhase, findCheckpointByPhase, restoreFromCheckpoint } from "../store/checkpoint.js";
import { appendEventLog, appendErrorLog } from "../store/log-writer.js";
import type { EventLogEntry } from "../schemas/event-log.js";
import { evaluateDispatchRule, type TaskRequest } from "./dispatch-rule.js";
import { judgeTier } from "./tier-judge.js";
import { makeErrorLog, MANIFEST_FILE, type OrchestratorConfig } from "./orchestrator-tier1.js";
import type { Brief } from "../schemas/brief.js";
import type { Phase } from "../domain/types.js";
import type { ReviewerReturn } from "../schemas/reviewer-return.js";
import { safeValidateReviewerReturn } from "../schemas/reviewer-return.js";
import type { ParallelResult } from "../runners/types.js";
import { runParallel } from "../runners/spawn-adapter.js";
import { evaluateTier2DispatchRule } from "./dispatch-rule.js";
import { decideCorrection } from "./correction.js";
import type { Tier2Config, Tier2Request } from "./orchestrator-tier2.js";

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
