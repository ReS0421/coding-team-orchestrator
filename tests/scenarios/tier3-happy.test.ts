import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier3, type Tier3Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { makeBrief, makeDispatchCard } from "../helpers/harness.js";
import { createFakeLeadRunner, type SharedOwnerTransition } from "../helpers/fake-lead-runner.js";
import { SharedOwnerState } from "../../src/domain/types.js";
import type { RunnerFn } from "../../src/runners/types.js";

let projectRoot: string;
let logDir: string;

function makeValidLeadReturn(manifest_seq = 0) {
  return {
    final_merge_candidate: true,
    execution_summary: "Lead execution complete",
    specialist_results: [{
      status: "done" as const,
      touched_files: ["src/feature.ts"],
      changeset: "changeset-1",
      delta_stub: "// delta",
      evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
    }],
    manifest_updates: {
      base_manifest_seq: manifest_seq,
      apply_mode: "all_or_fail" as const,
      patches: [{
        artifact_id: "feature",
        op: "set" as const,
        field: "lifecycle",
        new_value: "approved",
        reason: "lead done",
      }],
    },
  };
}

function makePassReviewerReturn() {
  return {
    review_report: "reports/review.md",
    disposition_recommendation: "PASS" as const,
    issues: [],
  };
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier3-happy-"));
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

function makeRequest(specialistCount = 5, hasSharedOwner = false): Tier2Request {
  const specialists = Array.from({ length: specialistCount }, (_, i) => ({
    id: `specialist-${i + 1}`,
    scope: [`src/module${i + 1}.ts`],
    owns: [] as string[],
  }));
  return {
    task: "Tier 3 E2E happy path",
    write_scope: specialists.map((s) => s.scope[0]),
    shared_surfaces: [],
    brief: makeBrief({ specialists }),
  };
}

describe("Tier 3 Happy Path Scenarios", () => {
  it("Scenario 1: 5 specialists, 1 shared owner, dual review PASS → done", async () => {
    const specialists = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i + 1}`,
      scope: [`src/module${i + 1}.ts`],
      owns: [] as string[],
    }));

    // Create specialist cards with s1 as shared owner
    const specialistCards = specialists.map((s, i) =>
      makeDispatchCard({
        id: s.id,
        role: i === 0 ? "shared_owner" : "specialist",
        tier: 3,
        is_shared_owner: i === 0,
      }),
    );

    const transitions: SharedOwnerTransition[] = [];
    const brief = makeBrief({
      specialists,
      shared: ["src/shared.ts"],
    });

    const { runner: leadRunner, getSharedOwnerTransitions } = createFakeLeadRunner({
      innerRunner: async () => ({
        status: "done" as const,
        touched_files: ["src/feature.ts"],
        changeset: "cs",
        delta_stub: "// d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      }),
      specialist_cards: specialistCards,
      brief,
      manifest: { project: "test", manifest_seq: 0, artifacts: [], transitions: [], checkpoints: [] },
      onSharedOwnerTransition: (t) => transitions.push(t),
    });

    // Build full runner: planner returns tasks_md, lead uses fakeLeadRunner, reviewers pass
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") return leadRunner(card);
      if (card.role === "reviewer") return makePassReviewerReturn();
      return makePassReviewerReturn();
    };

    const request: Tier2Request = {
      task: "Tier 3 E2E with shared owner",
      write_scope: specialists.map((s) => s.scope[0]),
      shared_surfaces: [{ path: "src/shared.ts", rule: "owner-lock", owner: "s1" }],
      brief,
    };

    const result = await runTier3(makeConfig(runner), request);
    expect(result.success).toBe(true);
    expect(result.tier).toBe(3);
    expect(result.phase).toBe("done");

    // Verify shared owner transitions: ACTIVE → ADVISORY → TERMINATED
    const ownerTransitions = getSharedOwnerTransitions().filter((t) => t.owner_id === "s1");
    // The fake runner records: start→ACTIVE, rolling done→ADVISORY, final→TERMINATED
    const toAdvisory = ownerTransitions.find((t) => t.to === SharedOwnerState.ADVISORY);
    const toTerminated = ownerTransitions.find((t) => t.to === SharedOwnerState.TERMINATED);
    expect(toAdvisory).toBeDefined();
    expect(toTerminated).toBeDefined();
  });

  it("Scenario 2: 4 specialists shared-free → done", async () => {
    const specialists = Array.from({ length: 4 }, (_, i) => ({
      id: `w${i + 1}`,
      scope: [`src/work${i + 1}.ts`],
      owns: [] as string[],
    }));

    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") return makeValidLeadReturn();
      return makePassReviewerReturn();
    };

    const request: Tier2Request = {
      task: "Tier 3 E2E shared-free",
      write_scope: specialists.map((s) => s.scope[0]),
      shared_surfaces: [],
      brief: makeBrief({ specialists }),
    };

    const result = await runTier3(makeConfig(runner), request);
    expect(result.success).toBe(true);
    expect(result.tier).toBe(3);
    expect(result.phase).toBe("done");
    expect(result.correction_count).toBe(0);
    expect(result.lead_crash_count).toBe(0);
    expect(result.integration_retry_count).toBe(0);
  });

  it("Scenario 3: checkpoints created correctly", async () => {
    const runner: RunnerFn = async (card) => {
      if (card.role === "planner") return { tasks_md: "tasks.md" };
      if (card.role === "execution_lead") return makeValidLeadReturn();
      return makePassReviewerReturn();
    };

    const request: Tier2Request = {
      task: "Checkpoint E2E",
      write_scope: Array.from({ length: 6 }, (_, i) => `src/m${i}.ts`),
      shared_surfaces: [],
      brief: makeBrief({
        specialists: Array.from({ length: 4 }, (_, i) => ({
          id: `cp${i + 1}`, scope: [`src/m${i}.ts`], owns: [],
        })),
      }),
    };

    const result = await runTier3(makeConfig(runner), request);
    expect(result.success).toBe(true);
    expect(result.checkpoints_created).toContain("cp-execution");
    expect(result.checkpoints_created).toContain("cp-review");
    expect(result.checkpoints_created).toContain("cp-done");
  });
});
