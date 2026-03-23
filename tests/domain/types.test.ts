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
