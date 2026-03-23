export const Tier = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export const ArtifactFamily = {
  CODE: "code",
  DOC: "doc",
  CONFIG: "config",
} as const;
export type ArtifactFamily = (typeof ArtifactFamily)[keyof typeof ArtifactFamily];

export const Lifecycle = {
  DRAFT: "draft",
  ACTIVE: "active",
  REVIEW: "review",
  APPROVED: "approved",
  MERGED: "merged",
  ARCHIVED: "archived",
} as const;
export type Lifecycle = (typeof Lifecycle)[keyof typeof Lifecycle];

export const Freshness = {
  FRESH: "fresh",
  STALE: "stale",
  EXPIRED: "expired",
} as const;
export type Freshness = (typeof Freshness)[keyof typeof Freshness];

export const ControlState = {
  IDLE: "idle",
  RUNNING: "running",
  HALTED: "halted",
} as const;
export type ControlState = (typeof ControlState)[keyof typeof ControlState];

export const SubmissionState = {
  DONE: "done",
  DONE_WITH_CONCERNS: "done_with_concerns",
  NEEDS_CONTEXT: "needs_context",
  BLOCKED: "blocked",
} as const;
export type SubmissionState = (typeof SubmissionState)[keyof typeof SubmissionState];

export const ErrorType = {
  PARSE_FAILURE: "parse_failure",
  TIMEOUT: "timeout",
  CONFLICT: "conflict",
  MISSING_CONTEXT: "missing_context",
  PERMISSION_DENIED: "permission_denied",
  INTERNAL: "internal",
  EXTERNAL: "external",
} as const;
export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

export const PropagationClass = {
  LOCAL: "local",
  SESSION: "session",
  GLOBAL: "global",
} as const;
export type PropagationClass = (typeof PropagationClass)[keyof typeof PropagationClass];

export const TimeoutClass = {
  SHORT: "short",
  MEDIUM: "medium",
  LONG: "long",
  INFINITE: "infinite",
} as const;
export type TimeoutClass = (typeof TimeoutClass)[keyof typeof TimeoutClass];

export const Role = {
  PLANNER: "planner",
  SPECIALIST: "specialist",
  REVIEWER: "reviewer",
  LEAD: "lead",
  OBSERVER: "observer",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Status = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type Status = (typeof Status)[keyof typeof Status];

export const ChangeClass = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  RENAME: "rename",
} as const;
export type ChangeClass = (typeof ChangeClass)[keyof typeof ChangeClass];
