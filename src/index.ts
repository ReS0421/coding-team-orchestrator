// ── team-orchestrator public API ──

// Domain types
export {
  Tier, Phase, SharedOwnerState, RollingSlotState, LeadPhase,
  ControlState, SubmissionState, Lifecycle, Freshness,
  ArtifactFamily, ErrorType, PropagationClass, TimeoutClass,
  Role, Status, ChangeClass, BriefState, CorrectionDisposition,
} from "./domain/index.js";

// Schemas (Zod + types + validators)
export {
  DispatchCardSchema, type DispatchCard, validateDispatchCard, safeValidateDispatchCard,
} from "./schemas/dispatch-card.js";
export {
  BriefSchema, type Brief, validateBrief, safeValidateBrief,
} from "./schemas/brief.js";
export {
  PlannerReturnSchema, type PlannerReturn, validatePlannerReturn, safeValidatePlannerReturn,
} from "./schemas/planner-return.js";
export {
  SpecialistSubmissionSchema, type SpecialistSubmission, validateSpecialistSubmission, safeValidateSpecialistSubmission,
} from "./schemas/specialist-submission.js";
export {
  ReviewerReturnSchema, type ReviewerReturn, validateReviewerReturn, safeValidateReviewerReturn,
} from "./schemas/reviewer-return.js";
export {
  LeadReturnSchema, type LeadReturn, validateLeadReturn, safeValidateLeadReturn,
} from "./schemas/lead-return.js";
export {
  ExecutionContractSchema, type ExecutionContract,
} from "./schemas/execution-contract.js";
export {
  ManifestPatchSetSchema, type ManifestPatchSet,
} from "./schemas/manifest-patch.js";
export {
  ErrorLogSchema, type ErrorLog as ErrorLogEntry,
} from "./schemas/error-log.js";
export {
  EventLogEntrySchema, type EventLogEntry,
} from "./schemas/event-log.js";

// Engine — orchestrators
export { runTier1, type OrchestratorConfig, type OrchestratorResult } from "./engine/orchestrator-tier1.js";
export { runTier2, type Tier2Config, type Tier2Request, type Tier2Result } from "./engine/orchestrator-tier2.js";
export { runTier3, type Tier3Config, type Tier3Result } from "./engine/orchestrator-tier3.js";

// Engine — building blocks
export { judgeTier, type TierJudgeInput, type TierJudgeResult } from "./engine/tier-judge.js";
export { evaluateDispatchRule, type DispatchRuleResult, type TaskRequest } from "./engine/dispatch-rule.js";
export { decideCorrection, decideTier3Correction, type CorrectionContext, type CorrectionDecision } from "./engine/correction.js";
export { runRollingDispatch, type RollingDispatchConfig, type RollingDispatchResult, type RollingSlot } from "./engine/rolling-dispatch.js";
export { runDualReview, mergeReviewIssues, type DualReviewConfig, type DualReviewResult } from "./engine/dual-reviewer.js";
export { planLeadRecovery, type LeadCrashContext, type RecoveryPlan } from "./engine/lead-recovery.js";
export { createHeartbeatState, recordHeartbeat, checkHeartbeat, diagnoseLeadStatus, type HeartbeatConfig, type HeartbeatState } from "./engine/heartbeat.js";
export { transitionSharedOwner, canAmendInAdvisory, terminateAllOwners, type SharedOwnerSession } from "./engine/shared-owner-lifecycle.js";

// Runners
export { createSpawnAdapter, runParallel, runSharedExecution, type SpawnAdapterConfig } from "./runners/spawn-adapter.js";
export type { RunnerFn, RunnerReturn, ParallelResult, SettledResult } from "./runners/types.js";

// Store
export { parseFrontmatter, serializeFrontmatter, readArtifact, writeArtifact, artifactExists } from "./store/artifact-store.js";
export { createEmptyManifest, loadManifest, saveManifest, findArtifact, addArtifact } from "./store/manifest.js";
export { createCheckpoint, restoreFromCheckpoint, findCheckpointByPhase, type PhaseLabel } from "./store/checkpoint.js";
export type { ProjectManifest, ManifestArtifact, ArtifactFile } from "./store/types.js";
