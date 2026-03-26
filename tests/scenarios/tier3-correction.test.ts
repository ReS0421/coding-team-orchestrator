import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier3, type Tier3Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { makeBrief, makeDispatchCard } from "../helpers/harness.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { LeadReturn } from "../../src/schemas/lead-return.js";
import type { ReviewerReturn } from "../../src/schemas/reviewer-return.js";

let projectRoot: string;
let logDir: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier3-correction-"));
  logDir = path.join(projectRoot, "logs");
  fs.mkdirSync(logDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function makeConfig(runner: RunnerFn, overrides?: Partial<Tier3Config>): Tier3Config {
  return {
    projectRoot,
    logDir,
    runner,
    maxLeadRetries: 1,
    maxCorrections: 4,
    onIntegrationTest: () => true,
    ...overrides,
  };
}

function makeRequest(): Tier2Request {
  return {
    task: "Tier 3 correction E2E",
    write_scope: Array.from({ length: 6 }, (_, i) => `src/mod${i}.ts`),
    shared_surfaces: [],
    brief: makeBrief({
      specialists: Array.from({ length: 4 }, (_, i) => ({
        id: `specialist-${i + 1}`,
        scope: [`src/mod${i}.ts`],
        owns: [] as string[],
      })),
    }),
  };
}

function makeValidLeadReturn(): LeadReturn {
  return {
    final_merge_candidate: true,
    execution_summary: "Lead done",
    specialist_results: [{
      status: "done",
      touched_files: ["src/mod1.ts"],
      changeset: "cs",
      delta_stub: "// d",
      evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
    }],
    manifest_updates: {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [{ artifact_id: "x", op: "set", field: "lifecycle", new_value: "approved", reason: "done" }],
    },
  };
}

function makeFailReviewerReturn(fixOwner = "specialist-1"): ReviewerReturn {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "FAIL",
    issues: [{
      issue_id: "blocking-issue",
      severity: "critical",
      blocking: true,
      evidence: "missing implementation",
      fix_owner: fixOwner,
    }],
  };
}

function makePassReviewerReturn(): ReviewerReturn {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "PASS",
    issues: [],
  };
}

describe("Tier 3 Correction/Crash Scenarios", () => {
  it("Scenario 1: Review FAIL → correction → PASS", async () => {
    let reviewCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") return makeValidLeadReturn();
      if (card.role === "reviewer") {
        reviewCallCount++;
        // First two calls (spec + quality) fail, subsequent calls pass
        if (reviewCallCount <= 2) return makeFailReviewerReturn();
        return makePassReviewerReturn();
      }
      return makePassReviewerReturn();
    };

    const result = await runTier3(makeConfig(runner), makeRequest());
    expect(result.success).toBe(true);
    expect(result.correction_count).toBeGreaterThan(0);
    expect(result.phase).toBe("done");
  });

  it("Scenario 2: Lead crash → respawn → PASS", async () => {
    let leadCallCount = 0;
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") {
        leadCallCount++;
        if (leadCallCount === 1) throw new Error("Lead crashed on first attempt");
        return makeValidLeadReturn();
      }
      return makePassReviewerReturn();
    };

    const result = await runTier3(makeConfig(runner, { maxLeadRetries: 1 }), makeRequest());
    expect(result.success).toBe(true);
    expect(result.lead_crash_count).toBe(1);
    expect(result.phase).toBe("done");
  });

  it("Scenario 3: Budget exceeded → escalation", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") return makeValidLeadReturn();
      if (card.role === "reviewer") return makeFailReviewerReturn(); // always FAIL
      return makePassReviewerReturn();
    };

    // With maxCorrections=4, max 4 total corrections, 2 per owner
    // Each FAIL round increments per_fix_owner_count["specialist-1"]
    const result = await runTier3(makeConfig(runner, { maxCorrections: 4 }), makeRequest());
    expect(result.success).toBe(false);
    expect(result.error).toContain("budget exceeded");
  });

  it("Scenario 4: Lead crash 2x → escalation", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") throw new Error("Lead always crashes");
      return makePassReviewerReturn();
    };

    const result = await runTier3(makeConfig(runner, { maxLeadRetries: 1 }), makeRequest());
    expect(result.success).toBe(false);
    expect(result.lead_crash_count).toBeGreaterThanOrEqual(1);
    expect(result.error).toContain("escalat");
  });
});
