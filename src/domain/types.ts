// ─── Tier ───────────────────────────────────────────────
export const Tier = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

// ─── ArtifactFamily (설계 §3 Family) ────────────────────
export const ArtifactFamily = {
  REFERENCE: "reference",
  CONTROL: "control",
  SUBMISSION: "submission",
} as const;
export type ArtifactFamily = (typeof ArtifactFamily)[keyof typeof ArtifactFamily];

// ─── Lifecycle (설계 §Lifecycle 도식) ────────────────────
export const Lifecycle = {
  DRAFT: "draft",
  PROPOSED: "proposed",
  APPROVED: "approved",
  REJECTED: "rejected",
  SUPERSEDED: "superseded",
  ARCHIVED: "archived",
} as const;
export type Lifecycle = (typeof Lifecycle)[keyof typeof Lifecycle];

// ─── Freshness (설계 §Freshness 2단계) ──────────────────
export const Freshness = {
  FRESH: "fresh",
  STALE_SOFT: "stale_soft",
  STALE_HARD: "stale_hard",
} as const;
export type Freshness = (typeof Freshness)[keyof typeof Freshness];

// ─── ControlState (설계 §차원 분리) ─────────────────────
export const ControlState = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  COMPLETED: "completed",
} as const;
export type ControlState = (typeof ControlState)[keyof typeof ControlState];

// ─── SubmissionState (설계 §차원 분리) ──────────────────
export const SubmissionState = {
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  REVISION_REQUESTED: "revision_requested",
} as const;
export type SubmissionState = (typeof SubmissionState)[keyof typeof SubmissionState];

// ─── ErrorType (설계 §에러 유형) ────────────────────────
export const ErrorType = {
  TIMEOUT: "timeout",
  CRASH: "crash",
  STALLED: "stalled",
  BLOCKED: "blocked",
  NEEDS_CONTEXT: "needs_context",
  MALFORMED_RETURN: "malformed_return",
  SILENT_FAILURE: "silent_failure",
} as const;
export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

// ─── PropagationClass (설계 §Propagation Class) ─────────
export const PropagationClass = {
  CONTAINED: "contained",
  DEPENDENT_HOLD: "dependent_hold",
  GLOBAL_ESCALATION: "global_escalation",
} as const;
export type PropagationClass = (typeof PropagationClass)[keyof typeof PropagationClass];

// ─── TimeoutClass (설계 §Timeout Profiles) ──────────────
export const TimeoutClass = {
  QUICK: "quick",
  STANDARD: "standard",
  EXTENDED: "extended",
  UNLIMITED: "unlimited",
} as const;
export type TimeoutClass = (typeof TimeoutClass)[keyof typeof TimeoutClass];

// ─── Role (설계 §Dispatch Card) ─────────────────────────
export const Role = {
  PLANNER: "planner",
  SPECIALIST: "specialist",
  EXECUTION_LEAD: "execution_lead",
  SHARED_OWNER: "shared_owner",
  REVIEWER: "reviewer",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

// ─── Status (설계 §4-status 프로토콜) ───────────────────
export const Status = {
  DONE: "done",
  DONE_WITH_CONCERNS: "done_with_concerns",
  NEEDS_CONTEXT: "needs_context",
  BLOCKED: "blocked",
} as const;
export type Status = (typeof Status)[keyof typeof Status];

// ─── ChangeClass (설계 §Change class) ───────────────────
export const ChangeClass = {
  STRUCTURAL: "structural",
  BEHAVIORAL: "behavioral",
  SCOPE: "scope",
  COSMETIC: "cosmetic",
} as const;
export type ChangeClass = (typeof ChangeClass)[keyof typeof ChangeClass];

// ─── BriefState (설계 §Tier 2 상태값) ───────────────────
export const BriefState = {
  BRIEFED: "briefed",
  IN_PROGRESS: "in_progress",
  NEEDS_FIX: "needs_fix",
  DONE: "done",
  ESCALATED: "escalated",
} as const;
export type BriefState = (typeof BriefState)[keyof typeof BriefState];

// ─── Phase (설계 §Execution Flow) ───────────────────────
export const Phase = {
  INTAKE: "intake",
  PLANNING: "planning",
  EXECUTION: "execution",
  REVIEW: "review",
  CORRECTION: "correction",
  DONE: "done",
  FAILED: "failed",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

// ─── CorrectionDisposition (설계 §Correction) ──────────
export const CorrectionDisposition = {
  FIX_AND_REREVIEW: "fix_and_rereview",
  ESCALATE: "escalate",
  ABORT: "abort",
} as const;
export type CorrectionDisposition = (typeof CorrectionDisposition)[keyof typeof CorrectionDisposition];

// ─── SharedChangeType (설계 §Shared Protocol) ──────────
export const SharedChangeType = {
  OWNER_COMMITTED: "owner_committed",
  UNEXPECTED_AMENDMENT: "unexpected_amendment",
  CONSUMER_BLOCKED: "consumer_blocked",
} as const;
export type SharedChangeType = (typeof SharedChangeType)[keyof typeof SharedChangeType];

// ─── SharedCommitState (설계 §Shared Protocol) ─────────
export const SharedCommitState = {
  PENDING: "pending",
  COMMITTED: "committed",
  FAILED: "failed",
} as const;
export type SharedCommitState = (typeof SharedCommitState)[keyof typeof SharedCommitState];

// ─── BlockedReason (설계 §Specialist Submission) ───────
export const BlockedReason = {
  SHARED_PENDING: "shared_pending",
  DEPENDENCY: "dependency",
  CONTEXT_MISSING: "context_missing",
} as const;
export type BlockedReason = (typeof BlockedReason)[keyof typeof BlockedReason];
