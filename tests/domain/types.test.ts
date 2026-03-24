import { describe, it, expect } from "vitest";
import {
  Tier,
  ArtifactFamily,
  Lifecycle,
  Freshness,
  ControlState,
  SubmissionState,
  ErrorType,
  PropagationClass,
  TimeoutClass,
  Role,
  Status,
  ChangeClass,
} from "../../src/domain/types.js";

describe("Tier", () => {
  it("has values 1, 2, 3", () => {
    expect(Tier.ONE).toBe(1);
    expect(Tier.TWO).toBe(2);
    expect(Tier.THREE).toBe(3);
  });
  it("has 3 values", () => {
    expect(Object.values(Tier)).toHaveLength(3);
  });
});

describe("ArtifactFamily", () => {
  it("has reference, control, submission", () => {
    expect(ArtifactFamily.REFERENCE).toBe("reference");
    expect(ArtifactFamily.CONTROL).toBe("control");
    expect(ArtifactFamily.SUBMISSION).toBe("submission");
  });
  it("has 3 values", () => {
    expect(Object.values(ArtifactFamily)).toHaveLength(3);
  });
});

describe("Lifecycle", () => {
  it("has all 6 states", () => {
    expect(Lifecycle.DRAFT).toBe("draft");
    expect(Lifecycle.PROPOSED).toBe("proposed");
    expect(Lifecycle.APPROVED).toBe("approved");
    expect(Lifecycle.REJECTED).toBe("rejected");
    expect(Lifecycle.SUPERSEDED).toBe("superseded");
    expect(Lifecycle.ARCHIVED).toBe("archived");
  });
  it("has 6 values", () => {
    expect(Object.values(Lifecycle)).toHaveLength(6);
  });
});

describe("Freshness", () => {
  it("has fresh, stale_soft, stale_hard", () => {
    expect(Freshness.FRESH).toBe("fresh");
    expect(Freshness.STALE_SOFT).toBe("stale_soft");
    expect(Freshness.STALE_HARD).toBe("stale_hard");
  });
  it("has 3 values", () => {
    expect(Object.values(Freshness)).toHaveLength(3);
  });
});

describe("ControlState", () => {
  it("has active, suspended, completed", () => {
    expect(ControlState.ACTIVE).toBe("active");
    expect(ControlState.SUSPENDED).toBe("suspended");
    expect(ControlState.COMPLETED).toBe("completed");
  });
  it("has 3 values", () => {
    expect(Object.values(ControlState)).toHaveLength(3);
  });
});

describe("SubmissionState", () => {
  it("has submitted, accepted, rejected, revision_requested", () => {
    expect(SubmissionState.SUBMITTED).toBe("submitted");
    expect(SubmissionState.ACCEPTED).toBe("accepted");
    expect(SubmissionState.REJECTED).toBe("rejected");
    expect(SubmissionState.REVISION_REQUESTED).toBe("revision_requested");
  });
  it("has 4 values", () => {
    expect(Object.values(SubmissionState)).toHaveLength(4);
  });
});

describe("ErrorType", () => {
  it("has all 7 error types", () => {
    expect(ErrorType.TIMEOUT).toBe("timeout");
    expect(ErrorType.CRASH).toBe("crash");
    expect(ErrorType.STALLED).toBe("stalled");
    expect(ErrorType.BLOCKED).toBe("blocked");
    expect(ErrorType.NEEDS_CONTEXT).toBe("needs_context");
    expect(ErrorType.MALFORMED_RETURN).toBe("malformed_return");
    expect(ErrorType.SILENT_FAILURE).toBe("silent_failure");
  });
  it("has 7 values", () => {
    expect(Object.values(ErrorType)).toHaveLength(7);
  });
});

describe("PropagationClass", () => {
  it("has contained, dependent_hold, global_escalation", () => {
    expect(PropagationClass.CONTAINED).toBe("contained");
    expect(PropagationClass.DEPENDENT_HOLD).toBe("dependent_hold");
    expect(PropagationClass.GLOBAL_ESCALATION).toBe("global_escalation");
  });
  it("has 3 values", () => {
    expect(Object.values(PropagationClass)).toHaveLength(3);
  });
});

describe("TimeoutClass", () => {
  it("has quick, standard, extended, unlimited", () => {
    expect(TimeoutClass.QUICK).toBe("quick");
    expect(TimeoutClass.STANDARD).toBe("standard");
    expect(TimeoutClass.EXTENDED).toBe("extended");
    expect(TimeoutClass.UNLIMITED).toBe("unlimited");
  });
  it("has 4 values", () => {
    expect(Object.values(TimeoutClass)).toHaveLength(4);
  });
});

describe("Role", () => {
  it("has planner, specialist, execution_lead, shared_owner, reviewer", () => {
    expect(Role.PLANNER).toBe("planner");
    expect(Role.SPECIALIST).toBe("specialist");
    expect(Role.EXECUTION_LEAD).toBe("execution_lead");
    expect(Role.SHARED_OWNER).toBe("shared_owner");
    expect(Role.REVIEWER).toBe("reviewer");
  });
  it("has 5 values", () => {
    expect(Object.values(Role)).toHaveLength(5);
  });
});

describe("Status", () => {
  it("has done, done_with_concerns, needs_context, blocked", () => {
    expect(Status.DONE).toBe("done");
    expect(Status.DONE_WITH_CONCERNS).toBe("done_with_concerns");
    expect(Status.NEEDS_CONTEXT).toBe("needs_context");
    expect(Status.BLOCKED).toBe("blocked");
  });
  it("has 4 values", () => {
    expect(Object.values(Status)).toHaveLength(4);
  });
});

describe("ChangeClass", () => {
  it("has structural, behavioral, scope, cosmetic", () => {
    expect(ChangeClass.STRUCTURAL).toBe("structural");
    expect(ChangeClass.BEHAVIORAL).toBe("behavioral");
    expect(ChangeClass.SCOPE).toBe("scope");
    expect(ChangeClass.COSMETIC).toBe("cosmetic");
  });
  it("has 4 values", () => {
    expect(Object.values(ChangeClass)).toHaveLength(4);
  });
});

// ─── Sprint 2 types ─────────────────────────────────────

import {
  BriefState,
  Phase,
  CorrectionDisposition,
} from "../../src/domain/types.js";

describe("BriefState", () => {
  it("has all 5 states", () => {
    expect(BriefState.BRIEFED).toBe("briefed");
    expect(BriefState.IN_PROGRESS).toBe("in_progress");
    expect(BriefState.NEEDS_FIX).toBe("needs_fix");
    expect(BriefState.DONE).toBe("done");
    expect(BriefState.ESCALATED).toBe("escalated");
  });
  it("has 5 values", () => {
    expect(Object.values(BriefState)).toHaveLength(5);
  });
});

describe("Phase", () => {
  it("has all 7 phases", () => {
    expect(Phase.INTAKE).toBe("intake");
    expect(Phase.PLANNING).toBe("planning");
    expect(Phase.EXECUTION).toBe("execution");
    expect(Phase.REVIEW).toBe("review");
    expect(Phase.CORRECTION).toBe("correction");
    expect(Phase.DONE).toBe("done");
    expect(Phase.FAILED).toBe("failed");
  });
  it("has 7 values", () => {
    expect(Object.values(Phase)).toHaveLength(7);
  });
});

describe("CorrectionDisposition", () => {
  it("has fix_and_rereview, escalate, abort", () => {
    expect(CorrectionDisposition.FIX_AND_REREVIEW).toBe("fix_and_rereview");
    expect(CorrectionDisposition.ESCALATE).toBe("escalate");
    expect(CorrectionDisposition.ABORT).toBe("abort");
  });
  it("has 3 values", () => {
    expect(Object.values(CorrectionDisposition)).toHaveLength(3);
  });
});

// ─── Sprint 3 types ─────────────────────────────────────

import {
  SharedChangeType,
  SharedCommitState,
  BlockedReason,
} from "../../src/domain/types.js";

describe("SharedChangeType", () => {
  it("has owner_committed, unexpected_amendment, consumer_blocked", () => {
    expect(SharedChangeType.OWNER_COMMITTED).toBe("owner_committed");
    expect(SharedChangeType.UNEXPECTED_AMENDMENT).toBe("unexpected_amendment");
    expect(SharedChangeType.CONSUMER_BLOCKED).toBe("consumer_blocked");
  });
  it("has 3 values", () => {
    expect(Object.values(SharedChangeType)).toHaveLength(3);
  });
});

describe("SharedCommitState", () => {
  it("has pending, committed, failed", () => {
    expect(SharedCommitState.PENDING).toBe("pending");
    expect(SharedCommitState.COMMITTED).toBe("committed");
    expect(SharedCommitState.FAILED).toBe("failed");
  });
  it("has 3 values", () => {
    expect(Object.values(SharedCommitState)).toHaveLength(3);
  });
});

describe("BlockedReason", () => {
  it("has shared_pending, dependency, context_missing", () => {
    expect(BlockedReason.SHARED_PENDING).toBe("shared_pending");
    expect(BlockedReason.DEPENDENCY).toBe("dependency");
    expect(BlockedReason.CONTEXT_MISSING).toBe("context_missing");
  });
  it("has 3 values", () => {
    expect(Object.values(BlockedReason)).toHaveLength(3);
  });
});
