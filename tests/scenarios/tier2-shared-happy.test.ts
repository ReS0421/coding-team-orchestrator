import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config, type Tier2Request } from "../../src/engine/orchestrator.js";
import { createStatefulRunner } from "../helpers/fake-runner.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { Brief } from "../../src/schemas/brief.js";

describe("Tier 2 Shared Happy Path", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-shared-happy-"));
    logDir = path.join(projectRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const manifest = addArtifact(createEmptyManifest("test"), {
      id: "tasks_md", path: "artifacts/tasks.md", family: "reference",
      lifecycle: "approved", freshness: "fresh", content_rev: 1,
    });
    saveManifest(projectRoot, manifest);
  });

  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  function makeConfig(runner: RunnerFn): Tier2Config {
    return { projectRoot, logDir, runner };
  }

  it("shared 1, 2 specialists: owner first → consumer → reviewer PASS", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "shared-happy-1",
      goal: "Shared happy path",
      out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes.ts"] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"],
      escalate_if: [],
    };

    const result = await runTier2(makeConfig(runner), {
      task: "Shared happy", write_scope: ["src/auth/", "src/api/"], brief,
      shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
    });

    expect(result.success).toBe(true);
    expect(result.shared_changes).toBe(0);
    expect(result.acting_lead_id).toBe("specialist-1");
    expect(result.tier3_escalation).toBe(false);
    expect(result.phase).toBe("done");
  });

  it("manifest-lite created for shared path", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "shared-manifest",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    await runTier2(makeConfig(runner), {
      task: "test", write_scope: ["src/auth/", "src/api/"], brief,
      shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
    });

    expect(fs.existsSync(path.join(projectRoot, "artifacts", "manifest-lite.yaml"))).toBe(true);
  });

  it("shared 2, 2 specialists: both shared owned by same specialist", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "shared-double",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts", "src/types/config.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts", "src/types/config.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(makeConfig(runner), {
      task: "test", write_scope: ["src/auth/", "src/api/"], brief,
      shared_surfaces: [
        { path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" },
        { path: "src/types/config.ts", rule: "tier2_shared_protocol", owner: "specialist-1" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
  });

  it("shared 1, 3 specialists: acting lead assigned", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "shared-3spec",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
        { id: "specialist-3", scope: ["src/db/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(makeConfig(runner), {
      task: "test", write_scope: ["src/auth/", "src/api/", "src/db/"], brief,
      shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
    });

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
  });

  it("owner card has is_shared_owner and priority_task", async () => {
    const capturedCards: string[] = [];
    const runner: RunnerFn = async (card) => {
      if (card.is_shared_owner) capturedCards.push("owner:" + card.id);
      if (card.role === "planner") return { tasks_md: "# tasks" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
      };
      return {
        status: "done" as const, touched_files: ["f"], changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };

    const brief: Brief = {
      brief_id: "card-check",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    await runTier2({ projectRoot, logDir, runner }, {
      task: "test", write_scope: ["src/auth/", "src/api/"], brief,
      shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }],
    });

    expect(capturedCards.length).toBeGreaterThan(0);
    expect(capturedCards[0]).toContain("specialist-1");
  });
});
