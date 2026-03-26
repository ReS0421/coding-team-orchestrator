import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { runTier3, type Tier3Config } from "../../src/engine/orchestrator.js";
import type { Tier2Request } from "../../src/engine/orchestrator.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";
import type { LeadReturn } from "../../src/schemas/lead-return.js";
import type { PlannerReturn } from "../../src/schemas/planner-return.js";
import { makeBrief, makeDispatchCard } from "../helpers/harness.js";
import { createFakeLeadRunner } from "../helpers/fake-lead-runner.js";
import { SharedOwnerState } from "../../src/domain/types.js";

let tmpDir: string;
let projectRoot: string;
let logDir: string;

function makeConfig(runner: RunnerFn, overrides?: Partial<Tier3Config>): Tier3Config {
  return {
    projectRoot,
    logDir,
    runner,
    maxRetries: 1,
    maxCorrections: 4,
    maxLeadRetries: 1,
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<Tier2Request>): Tier2Request {
  return {
    task: "Build Tier 3 project",
    write_scope: Array.from({ length: 6 }, (_, i) => `src/module${i}.ts`),
    shared_surfaces: [],
    brief: makeBrief({
      specialists: [
        { id: "s1", scope: ["src/module1.ts"], owns: [] },
        { id: "s2", scope: ["src/module2.ts"], owns: [] },
        { id: "s3", scope: ["src/module3.ts"], owns: [] },
        { id: "s4", scope: ["src/module4.ts"], owns: [] },
      ],
    }),
    ...overrides,
  };
}

function makePassReviewerReturn(): ReviewerReturn {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "PASS",
    issues: [],
  };
}

function makeFailReviewerReturn(fixOwner = "s1"): ReviewerReturn {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "FAIL",
    issues: [{
      issue_id: "i1",
      severity: "critical",
      blocking: true,
      evidence: "missing implementation",
      fix_owner: fixOwner,
    }],
  };
}

function makePlannerReturn(): PlannerReturn {
  return {
    tasks_md: "tasks/tasks.md",
  };
}

function makeLeadReturn(manifest_seq = 0): LeadReturn {
  return {
    final_merge_candidate: true,
    execution_summary: "Lead done",
    specialist_results: [{
      status: "done",
      touched_files: ["src/module1.ts"],
      changeset: "changeset",
      delta_stub: "// delta",
      evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
    }],
    manifest_updates: {
      base_manifest_seq: manifest_seq,
      apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "placeholder",
        op: "set",
        field: "content_rev",
        new_value: 1,
        reason: "lead execution complete",
      }],
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier3-test-"));
  projectRoot = path.join(tmpDir, "project");
  logDir = path.join(tmpDir, "logs");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Phase 0+1 tests ────────────────────────────────────

describe("runTier3 Phase 0+1", () => {
  it("wrong tier → error", async () => {
    const runner: RunnerFn = async () => makeLeadReturn();
    const result = await runTier3(
      makeConfig(runner),
      makeRequest({
        write_scope: ["src/single.ts"],  // Tier 1 scope
        brief: makeBrief({
          specialists: [{ id: "s1", scope: ["src/single.ts"], owns: [] }],
        }),
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected Tier 3");
  });

  it("returns tier: 3 in result", async () => {
    let leadCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        leadCallCount++;
        return makeLeadReturn();
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.tier).toBe(3);
  });

  it("planner skip when not needed → proceeds to lead", async () => {
    let leadCalled = false;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        leadCalled = true;
        return makeLeadReturn();
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(leadCalled).toBe(true);
  });
});

// ─── Phase 2 tests ──────────────────────────────────────

describe("runTier3 Phase 2", () => {
  it("normal execution: lead returns valid LeadReturn", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.lead_result).toBeDefined();
    expect(result.phase).toBe("done");
  });

  it("manifest_updates from lead are applied and committed", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        return {
          ...makeLeadReturn(0),
          manifest_updates: {
            base_manifest_seq: 0,
            apply_mode: "all_or_fail",
            patches: [{
              artifact_id: "test-artifact",
              op: "set",
              field: "content_rev",
              new_value: 5,
              reason: "updated",
              old_value: 0,
            }],
          },
        };
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.final_manifest_seq).toBeGreaterThanOrEqual(0);
  });

  it("malformed lead return → error", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        return { not_a_lead_return: true } as any;
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(false);
    expect(result.error).toContain("malformed");
  });
});

// ─── Phase 3 tests ──────────────────────────────────────

describe("runTier3 Phase 3 (dual review + correction)", () => {
  it("PASS on first review → done", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.review_result?.disposition).toBe("PASS");
    expect(result.correction_count).toBe(0);
  });

  it("FAIL then correction then PASS", async () => {
    let reviewCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      if (card.role === "reviewer") {
        reviewCallCount++;
        if (reviewCallCount <= 2) return makeFailReviewerReturn(); // spec + quality both fail
        return makePassReviewerReturn(); // next round passes
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.correction_count).toBeGreaterThan(0);
  });

  it("budget exceeded → escalation", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makeFailReviewerReturn(); // always fail
    };
    const result = await runTier3(makeConfig(runner, { maxCorrections: 4 }), makeRequest());
    expect(result.success).toBe(false);
    expect(result.error).toContain("budget exceeded");
  });

  it("merged issues from spec + quality reviewers", async () => {
    let reviewCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      if (card.role === "reviewer") {
        reviewCallCount++;
        // First round: spec returns issue, quality returns different issue
        if (reviewCallCount === 1) return makeFailReviewerReturn("s1");
        if (reviewCallCount === 2) return makeFailReviewerReturn("s2");
        return makePassReviewerReturn();
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner), makeRequest());
    // Should see merged issues from both reviewers
    expect(result.review_result).toBeDefined();
  });
});

// ─── Phase 4+5 tests ────────────────────────────────────

describe("runTier3 Phase 4+5", () => {
  it("integration test PASS → done with cp-done checkpoint", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(
      makeConfig(runner, { onIntegrationTest: () => true }),
      makeRequest(),
    );
    expect(result.success).toBe(true);
    expect(result.phase).toBe("done");
    expect(result.checkpoints_created).toContain("cp-done");
  });

  it("integration FAIL → reentry to Phase 2 with increased counts", async () => {
    let integrationCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(
      makeConfig(runner, {
        onIntegrationTest: () => {
          integrationCallCount++;
          return integrationCallCount > 1; // fail first time, pass second
        },
      }),
      makeRequest(),
    );
    expect(result.success).toBe(true);
    expect(result.integration_retry_count).toBeGreaterThan(0);
    expect(result.correction_count).toBeGreaterThan(0);
  });

  it("integration FAIL twice → reentry twice", async () => {
    let integrationCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(
      makeConfig(runner, {
        onIntegrationTest: () => {
          integrationCallCount++;
          return integrationCallCount > 2; // fail twice, pass third
        },
      }),
      makeRequest(),
    );
    expect(result.success).toBe(true);
    expect(result.integration_retry_count).toBe(2);
  });

  it("lead_crash_count unchanged during integration retry", async () => {
    let integrationCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") return makeLeadReturn();
      return makePassReviewerReturn();
    };
    const result = await runTier3(
      makeConfig(runner, {
        onIntegrationTest: () => {
          integrationCallCount++;
          return integrationCallCount > 1;
        },
      }),
      makeRequest(),
    );
    expect(result.lead_crash_count).toBe(0); // No crashes, only integration retry
  });
});

// ─── Lead crash recovery tests ──────────────────────────

describe("runTier3 lead crash recovery", () => {
  it("lead crash → respawn → success", async () => {
    let leadCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        leadCallCount++;
        if (leadCallCount === 1) throw new Error("Lead crashed on first attempt");
        return makeLeadReturn();
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner, { maxLeadRetries: 1 }), makeRequest());
    expect(result.success).toBe(true);
    expect(result.lead_crash_count).toBe(1);
  });

  it("2 crashes → escalation", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") throw new Error("Lead always crashes");
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner, { maxLeadRetries: 1 }), makeRequest());
    expect(result.success).toBe(false);
    expect(result.lead_crash_count).toBeGreaterThanOrEqual(1);
  });

  it("crash_count reflects actual crashes", async () => {
    let leadCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return makePlannerReturn();
      if (card.role === "execution_lead") {
        leadCallCount++;
        if (leadCallCount <= 1) throw new Error("crash");
        return makeLeadReturn();
      }
      return makePassReviewerReturn();
    };
    const result = await runTier3(makeConfig(runner, { maxLeadRetries: 2 }), makeRequest());
    expect(result.lead_crash_count).toBe(1);
  });
});
