import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { createStatefulRunner, fakeRunner } from "../helpers/fake-runner.js";
import { makeBrief } from "../helpers/harness.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn } from "../../src/runners/types.js";

describe("Tier 2 Happy Path", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-happy-"));
    logDir = path.join(projectRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    // Setup manifest with approved tasks_md
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

  function makeConfig(runner: RunnerFn): Tier2Config {
    return { projectRoot, logDir, runner };
  }

  function makeRequest(overrides?: Partial<Tier2Request>): Tier2Request {
    return {
      task: "Implement auth refresh",
      write_scope: ["src/auth/", "src/api/"],
      brief: makeBrief(),
      ...overrides,
    };
  }

  it("completes successfully with 2 specialists and reviewer PASS", async () => {
    const runner = createStatefulRunner({ correctionBehavior: "always_pass" });
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.success).toBe(true);
    expect(result.phase).toBe("done");
    expect(result.tier).toBe(2);
    expect(result.correction_count).toBe(0);
  });

  it("specialist_results contains 2 settled entries", async () => {
    const runner = createStatefulRunner();
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.specialist_results.all_succeeded).toBe(true);
    expect(result.specialist_results.settled).toHaveLength(2);
  });

  it("review_result exists with PASS disposition", async () => {
    const runner = createStatefulRunner();
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.review_result).toBeDefined();
    expect(result.review_result!.disposition_recommendation).toBe("PASS");
  });

  it("review_result includes cross_check", async () => {
    const runner = createStatefulRunner();
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.review_result!.cross_check).toBeDefined();
    expect(result.review_result!.cross_check!.length).toBeGreaterThan(0);
    expect(result.review_result!.cross_check!.every((c) => c.pass)).toBe(true);
  });

  it("skips planner when tasks_md is approved+fresh", async () => {
    const runner = createStatefulRunner();
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.planner_result).toBeUndefined();
  });

  it("runs planner when manifest has no tasks_md", async () => {
    // Remove the pre-set manifest
    const emptyManifest = createEmptyManifest("test");
    saveManifest(projectRoot, emptyManifest);

    const runner = createStatefulRunner();
    const result = await runTier2(makeConfig(runner as RunnerFn), makeRequest());

    expect(result.success).toBe(true);
    expect(result.planner_result).toBeDefined();
  });

  it("works with 3 specialists", async () => {
    const brief = makeBrief({
      specialists: [
        { id: "specialist-1", scope: ["src/a/"], owns: [] },
        { id: "specialist-2", scope: ["src/b/"], owns: [] },
        { id: "specialist-3", scope: ["src/c/"], owns: [] },
      ],
    });
    const runner = createStatefulRunner();
    const result = await runTier2(
      makeConfig(runner as RunnerFn),
      makeRequest({ brief, write_scope: ["src/a/", "src/b/", "src/c/"] }),
    );

    expect(result.success).toBe(true);
    expect(result.specialist_results.settled).toHaveLength(3);
  });
});
