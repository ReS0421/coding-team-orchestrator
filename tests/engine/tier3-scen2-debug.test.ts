import { it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier3, type Tier3Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { makeBrief } from "../helpers/harness.js";
import type { RunnerFn } from "../../src/runners/types.js";

let projectRoot: string;
let logDir: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t3s2dbg-"));
  logDir = path.join(projectRoot, "logs");
  fs.mkdirSync(logDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

it("scenario 2 debug: 4 specialists", async () => {
  const specialists = Array.from({ length: 4 }, (_, i) => ({
    id: `w${i + 1}`,
    scope: [`src/work${i + 1}.ts`],
    owns: [] as string[],
  }));

  const runner: RunnerFn = async (card) => {
    console.log("RUNNER:", card.role, card.id);
    if (card.role === "planner") return { tasks_md: "tasks.md" };
    if (card.role === "execution_lead") return {
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
        base_manifest_seq: 0,
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
    return {
      review_report: "reports/review.md",
      disposition_recommendation: "PASS" as const,
      issues: [],
    };
  };

  const request: Tier2Request = {
    task: "Tier 3 E2E shared-free",
    write_scope: specialists.map((s) => s.scope[0]),
    shared_surfaces: [],
    brief: makeBrief({ specialists }),
  };

  const result = await runTier3(
    { projectRoot, logDir, runner, maxLeadRetries: 1, maxCorrections: 4, onIntegrationTest: () => true },
    request,
  );
  console.log("RESULT:", JSON.stringify(result, null, 2));
  expect(result.success).toBe(true);
});
