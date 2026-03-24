import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { fakeRunner } from "../helpers/fake-runner.js";
import { makeBrief } from "../helpers/harness.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn, RunnerReturn } from "../../src/runners/types.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

describe("Tier 2 Error Contained", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-error-"));
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

  function makeConfig(runner: RunnerFn): Tier2Config {
    return { projectRoot, logDir, runner };
  }

  function makeRequest(): Tier2Request {
    return {
      task: "Implement auth refresh",
      write_scope: ["src/auth/", "src/api/"],
      brief: makeBrief(),
    };
  }

  it("succeeds when specialist-1 crashes once then recovers on retry", async () => {
    let specialist1Calls = 0;

    const crashThenRecoverRunner: RunnerFn = async (card: DispatchCard): Promise<RunnerReturn> => {
      if (card.role === "specialist" && card.id.includes("specialist-1")) {
        specialist1Calls++;
        if (specialist1Calls === 1) {
          throw new Error("specialist-1 crashed!");
        }
      }
      return fakeRunner(card);
    };

    const result = await runTier2(makeConfig(crashThenRecoverRunner), makeRequest());

    expect(result.success).toBe(true);
    expect(result.phase).toBe("done");
    expect(specialist1Calls).toBe(2); // first crash + retry success
  });

  it("specialist-2 is unaffected by specialist-1 crash (contained)", async () => {
    let specialist2Calls = 0;

    const crashRunner: RunnerFn = async (card: DispatchCard): Promise<RunnerReturn> => {
      if (card.role === "specialist" && card.id.includes("specialist-2")) {
        specialist2Calls++;
      }
      if (card.role === "specialist" && card.id.includes("specialist-1")) {
        throw new Error("specialist-1 always crashes");
      }
      return fakeRunner(card);
    };

    await runTier2(makeConfig(crashRunner), makeRequest());

    // specialist-2 should only be called once (no retry needed)
    expect(specialist2Calls).toBe(1);
  });

  it("fails when specialist crash exhausts retries", async () => {
    const alwaysCrashRunner: RunnerFn = async (card: DispatchCard): Promise<RunnerReturn> => {
      if (card.role === "specialist" && card.id.includes("specialist-1")) {
        throw new Error("always crashes");
      }
      return fakeRunner(card);
    };

    const result = await runTier2(makeConfig(alwaysCrashRunner), makeRequest());

    expect(result.success).toBe(false);
    expect(result.phase).toBe("execution");
    expect(result.error).toMatch(/failed/i);
  });

  it("error log exists after specialist crash", async () => {
    const alwaysCrashRunner: RunnerFn = async (card: DispatchCard): Promise<RunnerReturn> => {
      if (card.role === "specialist" && card.id.includes("specialist-1")) {
        throw new Error("crashes forever");
      }
      return fakeRunner(card);
    };

    await runTier2(makeConfig(alwaysCrashRunner), makeRequest());

    const errorLogPath = path.join(logDir, "errors.ndjson");
    expect(fs.existsSync(errorLogPath)).toBe(true);
    const logs = fs.readFileSync(errorLogPath, "utf-8").trim().split("\n");
    expect(logs.length).toBeGreaterThan(0);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.error_type).toBe("crash");
    expect(parsed.resolution).not.toBe("retry"); // should be escalate since retries exhausted
  });
});
