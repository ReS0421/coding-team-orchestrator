import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createSpawnAdapter, type SpawnOptions, type SpawnResult } from "../../src/runners/spawn-adapter.js";
import { runTier2, type Tier2Config, type Tier2Request } from "../../src/engine/orchestrator-tier2.js";
import type { Brief } from "../../src/schemas/brief.js";

describe("Tier 2 dry-run integration", () => {
  let tmpDir: string;
  let logDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-dryrun-"));
    logDir = path.join(tmpDir, ".store");
    fs.mkdirSync(logDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeBrief(): Brief {
    return {
      brief_id: "dryrun-brief",
      goal: "Add JSDoc to tier-judge and dispatch-rule",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/engine/tier-judge.ts"], owns: [] },
        { id: "specialist-2", scope: ["src/engine/dispatch-rule.ts"], owns: [] },
      ],
      shared: [],
      accept_checks: ["build passes", "tests pass"],
      escalate_if: [],
    };
  }

  it("full Tier 2 flow: 2 specialists + reviewer PASS", async () => {
    const spawnCalls: Array<{ runtime: string; role: string }> = [];

    const fakeSpawn = async (task: string, options: SpawnOptions): Promise<SpawnResult> => {
      const role = task.includes("아키텍트") ? "planner"
        : task.includes("리뷰어") ? "reviewer"
        : "specialist";
      spawnCalls.push({ runtime: options.runtime, role });

      if (role === "planner") {
        return {
          success: true,
          output: JSON.stringify({
            tasks_md: "## Tasks\n- specialist-1: JSDoc for tier-judge\n- specialist-2: JSDoc for dispatch-rule",
            tier_recommendation: 2,
          }),
        };
      }

      if (role === "reviewer") {
        return {
          success: true,
          output: JSON.stringify({
            review_report: "All JSDoc additions are correct and complete",
            disposition_recommendation: "PASS",
            issues: [],
            cross_check: [
              { check: "scope_violation", pass: true },
              { check: "goal_met", pass: true },
            ],
          }),
        };
      }

      // specialist
      const specId = task.includes("tier-judge") ? "specialist-1" : "specialist-2";
      const file = specId === "specialist-1" ? "src/engine/tier-judge.ts" : "src/engine/dispatch-rule.ts";
      return {
        success: true,
        output: JSON.stringify({
          status: "done",
          touched_files: [file],
          changeset: `Added JSDoc to ${file}`,
          delta_stub: `// JSDoc additions for ${file}`,
          evidence: { build_pass: true, test_pass: true, test_summary: "all tests pass" },
        }),
      };
    };

    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: tmpDir },
    });

    const config: Tier2Config = { projectRoot: tmpDir, logDir, runner };
    const request: Tier2Request = {
      task: "Add JSDoc to tier-judge and dispatch-rule",
      write_scope: ["src/engine/tier-judge.ts", "src/engine/dispatch-rule.ts"],
      brief: makeBrief(),
    };

    const result = await runTier2(config, request);

    expect(result.success).toBe(true);
    expect(result.tier).toBe(2);
    expect(result.phase).toBe("done");
    expect(result.correction_count).toBe(0);

    // Verify spawn calls: planner (subagent) + specialists (acp) + reviewer (subagent)
    expect(spawnCalls.some(c => c.role === "planner" && c.runtime === "subagent")).toBe(true);
    expect(spawnCalls.filter(c => c.role === "specialist" && c.runtime === "acp").length).toBe(2);
    expect(spawnCalls.some(c => c.role === "reviewer" && c.runtime === "subagent")).toBe(true);
  });

  it("Tier 2 with review FAIL → correction → PASS", async () => {
    let reviewCount = 0;

    const fakeSpawn = async (task: string, options: SpawnOptions): Promise<SpawnResult> => {
      const role = task.includes("아키텍트") ? "planner"
        : task.includes("리뷰어") ? "reviewer"
        : "specialist";

      if (role === "planner") {
        return {
          success: true,
          output: JSON.stringify({
            tasks_md: "## Tasks\n- Fix issues",
            tier_recommendation: 2,
          }),
        };
      }

      if (role === "reviewer") {
        reviewCount++;
        if (reviewCount === 1) {
          return {
            success: true,
            output: JSON.stringify({
              review_report: "Missing test for edge case",
              disposition_recommendation: "FAIL",
              issues: [{
                issue_id: "ISS-1",
                severity: "major",
                blocking: true,
                evidence: "No test for null input",
                fix_owner: "specialist-1",
              }],
            }),
          };
        }
        return {
          success: true,
          output: JSON.stringify({
            review_report: "Fixed. All good now.",
            disposition_recommendation: "PASS",
            issues: [],
          }),
        };
      }

      // specialist
      return {
        success: true,
        output: JSON.stringify({
          status: "done",
          touched_files: ["src/engine/tier-judge.ts"],
          changeset: "Applied fix",
          delta_stub: "// fix",
          evidence: { build_pass: true, test_pass: true, test_summary: "all pass" },
        }),
      };
    };

    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: tmpDir },
    });

    const config: Tier2Config = { projectRoot: tmpDir, logDir, runner, maxCorrections: 2 };
    const request: Tier2Request = {
      task: "Fix tier-judge edge case",
      write_scope: ["src/engine/tier-judge.ts"],
      brief: makeBrief(),
    };

    const result = await runTier2(config, request);

    expect(result.success).toBe(true);
    expect(result.correction_count).toBe(1);
  });
});
