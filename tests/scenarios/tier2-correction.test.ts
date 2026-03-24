import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { createStatefulRunner } from "../helpers/fake-runner.js";
import { makeBrief } from "../helpers/harness.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn } from "../../src/runners/types.js";

describe("Tier 2 Correction", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-correction-"));
    logDir = path.join(projectRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const manifest = addArtifact(createEmptyManifest("test"), {
      id: "tasks_md",
      path: "artifacts/tasks.md",
      family: "reference",
      lifecycle: "approved",
      freshness: "fresh",
      content_rev: 1,
    });
    saveManifest(projectRoot, manifest);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function makeConfig(runner: RunnerFn, maxCorrections?: number): Tier2Config {
    return { projectRoot, logDir, runner, maxCorrections };
  }

  function makeRequest(): Tier2Request {
    return {
      task: "Implement auth refresh",
      write_scope: ["src/auth/", "src/api/"],
      brief: makeBrief(),
    };
  }

  it("succeeds after correction: reviewer FAIL → fix → re-review PASS", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" });
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.success).toBe(true);
    expect(result.phase).toBe("done");
    expect(result.correction_count).toBe(1);
  });

  it("review_result is PASS after correction", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "fail_then_pass" });
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.review_result).toBeDefined();
    expect(result.review_result!.disposition_recommendation).toBe("PASS");
  });

  it("escalates when correction max exceeded", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" });
    const result = await runTier2(makeConfig(runner as RunnerFn, 2), makeRequest());

    expect(result.success).toBe(false);
    expect(result.phase).toBe("failed");
    expect(result.error).toMatch(/escalat/i);
  });

  it("correction_count reflects actual corrections before escalation", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" });
    const result = await runTier2(makeConfig(runner as RunnerFn, 2), makeRequest());

    // Should have tried max_corrections times before escalating
    expect(result.correction_count).toBeGreaterThanOrEqual(1);
  });

  it("escalates immediately with maxCorrections=0", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "always_fail" });
    const result = await runTier2(makeConfig(runner as RunnerFn, 0), makeRequest());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/escalat/i);
    expect(result.correction_count).toBe(0);
  });
});
