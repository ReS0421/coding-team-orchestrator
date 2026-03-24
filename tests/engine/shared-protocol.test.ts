import { describe, it, expect } from "vitest";
import {
  identifySharedOwner,
  buildExecutionSequence,
  evaluateSharedChange,
  checkTier3EscalationTriggers,
  handleUnexpectedSharedChange,
  type SharedChangeHistory,
} from "../../src/engine/shared-protocol.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";

function makeBrief(overrides?: Partial<Brief>): Brief {
  return {
    brief_id: "test-brief",
    goal: "Test goal",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
      { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes.ts"] },
    ],
    shared: ["src/types/auth.ts"],
    accept_checks: ["build passes"],
    escalate_if: [],
    ...overrides,
  };
}

function makeSubmission(overrides?: Partial<SpecialistSubmission>): SpecialistSubmission {
  return {
    status: "done",
    touched_files: ["src/index.ts"],
    changeset: "abc123",
    delta_stub: "diff --git",
    evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
    ...overrides,
  } as SpecialistSubmission;
}

function makeHistory(overrides?: Partial<SharedChangeHistory>): SharedChangeHistory {
  return {
    total_shared_changes: 0,
    consumer_blocked_count: 0,
    undiscovered_shared_surfaces: [],
    ...overrides,
  };
}

// ─── identifySharedOwner ────────────────────────────────

describe("identifySharedOwner", () => {
  it("identifies the specialist who owns the shared path", () => {
    const result = identifySharedOwner(makeBrief());
    expect(result.ownerId).toBe("specialist-1");
    expect(result.sharedPaths).toEqual(["src/types/auth.ts"]);
  });

  it("picks specialist with most shared ownership on tie-break by order", () => {
    const brief = makeBrief({
      specialists: [
        { id: "spec-a", scope: ["src/a/"], owns: ["src/shared.ts"] },
        { id: "spec-b", scope: ["src/b/"], owns: ["src/shared.ts"] },
      ],
      shared: ["src/shared.ts"],
    });
    // Both own 1 shared path → first in order wins
    expect(identifySharedOwner(brief).ownerId).toBe("spec-a");
  });

  it("picks specialist with more shared paths", () => {
    const brief = makeBrief({
      specialists: [
        { id: "spec-a", scope: ["src/a/"], owns: ["src/shared1.ts"] },
        { id: "spec-b", scope: ["src/b/"], owns: ["src/shared1.ts", "src/shared2.ts"] },
      ],
      shared: ["src/shared1.ts", "src/shared2.ts"],
    });
    expect(identifySharedOwner(brief).ownerId).toBe("spec-b");
  });
});

// ─── buildExecutionSequence ─────────────────────────────

describe("buildExecutionSequence", () => {
  it("separates owner and consumer", () => {
    const result = buildExecutionSequence(makeBrief());
    expect(result.ownerIds).toEqual(["specialist-1"]);
    expect(result.consumerIds).toEqual(["specialist-2"]);
    expect(result.sequence).toBe("owner_first");
  });
});

// ─── evaluateSharedChange ───────────────────────────────

describe("evaluateSharedChange", () => {
  it("amendment done → unexpected_amendment, low severity", () => {
    const sub = makeSubmission({ shared_amendment_flag: true, status: "done" });
    const result = evaluateSharedChange(sub, makeBrief());
    expect(result.type).toBe("unexpected_amendment");
    expect(result.severity).toBe("low");
    expect(result.needs_redispatch).toBe(false);
  });

  it("amendment blocked → consumer_blocked, high severity", () => {
    const sub = makeSubmission({ shared_amendment_flag: true, status: "blocked" });
    const result = evaluateSharedChange(sub, makeBrief());
    expect(result.type).toBe("consumer_blocked");
    expect(result.severity).toBe("high");
    expect(result.needs_redispatch).toBe(true);
  });

  it("blocked_on shared_pending → consumer_blocked, high severity", () => {
    const sub = makeSubmission({
      status: "blocked",
      blocked_on: { reason: "shared_pending", surface: "src/types/auth.ts", owner_id: "specialist-1" },
    });
    const result = evaluateSharedChange(sub, makeBrief());
    expect(result.type).toBe("consumer_blocked");
    expect(result.severity).toBe("high");
  });
});

// ─── checkTier3EscalationTriggers ───────────────────────

describe("checkTier3EscalationTriggers", () => {
  it("returns true when total_shared_changes >= 2", () => {
    expect(checkTier3EscalationTriggers(makeHistory({ total_shared_changes: 2 }))).toBe(true);
  });

  it("returns true when undiscovered shared surfaces exist", () => {
    expect(checkTier3EscalationTriggers(makeHistory({
      undiscovered_shared_surfaces: ["src/new-shared.ts"],
    }))).toBe(true);
  });

  it("returns true when consumer blocked >= 2", () => {
    expect(checkTier3EscalationTriggers(makeHistory({ consumer_blocked_count: 2 }))).toBe(true);
  });

  it("returns false when all below threshold", () => {
    expect(checkTier3EscalationTriggers(makeHistory())).toBe(false);
  });
});

// ─── handleUnexpectedSharedChange ───────────────────────

describe("handleUnexpectedSharedChange", () => {
  it("continues on amendment done with no escalation triggers", () => {
    const sub = makeSubmission({ shared_amendment_flag: true, status: "done" });
    const result = handleUnexpectedSharedChange(sub, makeBrief(), makeHistory());
    expect(result.action).toBe("continue");
  });

  it("redispatches owner on first consumer blocked", () => {
    const sub = makeSubmission({
      status: "blocked",
      blocked_on: { reason: "shared_pending", surface: "src/types/auth.ts", owner_id: "specialist-1" },
    });
    const result = handleUnexpectedSharedChange(sub, makeBrief(), makeHistory());
    expect(result.action).toBe("redispatch_owner");
    expect(result.re_dispatch_card).toBeDefined();
    expect(result.re_dispatch_card!.is_shared_owner).toBe(true);
  });

  it("escalates to tier3 when total shared changes >= 2", () => {
    const sub = makeSubmission({ shared_amendment_flag: true, status: "done" });
    const result = handleUnexpectedSharedChange(
      sub, makeBrief(), makeHistory({ total_shared_changes: 2 }),
    );
    expect(result.action).toBe("escalate_tier3");
  });

  it("escalates to tier3 when consumer blocked + total changes would reach threshold", () => {
    const sub = makeSubmission({
      status: "blocked",
      blocked_on: { reason: "shared_pending", surface: "src/types/auth.ts", owner_id: "specialist-1" },
    });
    const result = handleUnexpectedSharedChange(
      sub, makeBrief(), makeHistory({ total_shared_changes: 1 }),
    );
    expect(result.action).toBe("escalate_tier3");
  });

  it("escalates on undiscovered shared surfaces", () => {
    const sub = makeSubmission({ status: "done" });
    const result = handleUnexpectedSharedChange(
      sub, makeBrief(), makeHistory({ undiscovered_shared_surfaces: ["src/new.ts"] }),
    );
    expect(result.action).toBe("escalate_tier3");
  });

  it("escalates on consumer blocked count >= 2", () => {
    const sub = makeSubmission({ status: "done" });
    const result = handleUnexpectedSharedChange(
      sub, makeBrief(), makeHistory({ consumer_blocked_count: 2 }),
    );
    expect(result.action).toBe("escalate_tier3");
  });
});
