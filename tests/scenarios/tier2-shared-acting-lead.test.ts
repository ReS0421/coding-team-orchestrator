import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config } from "../../src/engine/orchestrator.js";
import { createStatefulRunner } from "../helpers/fake-runner.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { Brief } from "../../src/schemas/brief.js";

describe("Tier 2 Shared — Acting Lead", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-acting-lead-"));
    logDir = path.join(projectRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const manifest = addArtifact(createEmptyManifest("test"), {
      id: "tasks_md", path: "artifacts/tasks.md", family: "reference",
      lifecycle: "approved", freshness: "fresh", content_rev: 1,
    });
    saveManifest(projectRoot, manifest);
  });

  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  it("2 specialists + shared → shared owner is acting lead", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "al-2spec-shared",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }] },
    );

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
  });

  it("3 specialists + shared → shared owner is acting lead", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "al-3spec-shared",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: [] },
        { id: "specialist-2", scope: ["src/api/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-3", scope: ["src/db/"], owns: [] },
      ],
      shared: ["src/types/auth.ts"],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/", "src/db/"], brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-2" }] },
    );

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-2");
  });

  it("3 specialists + no shared → acting lead = first specialist (Branch B)", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "al-3spec-noshared",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: [] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
        { id: "specialist-3", scope: ["src/db/"], owns: [] },
      ],
      shared: [],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/", "src/db/"], brief },
    );

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
    // Should use Branch B (shared-free + acting lead), not shared path
    expect(result.shared_changes).toBe(0);
    expect(result.tier3_escalation).toBe(false);
  });

  it("3 specialists + no shared → manifest-lite created", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "al-3spec-manifest",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: [] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
        { id: "specialist-3", scope: ["src/db/"], owns: [] },
      ],
      shared: [],
      accept_checks: ["build"], escalate_if: [],
    };

    await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/", "src/db/"], brief },
    );

    expect(fs.existsSync(path.join(projectRoot, "artifacts", "manifest-lite.yaml"))).toBe(true);
  });

  it("2 specialists + no shared → no acting lead (Branch C)", async () => {
    const runner = createStatefulRunner() as RunnerFn;
    const brief: Brief = {
      brief_id: "al-2spec-noshared",
      goal: "Test", out_of_scope: [],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: [] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
      shared: [],
      accept_checks: ["build"], escalate_if: [],
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief },
    );

    expect(result.success).toBe(true);
    expect(result.acting_lead_id).toBeUndefined();
    // No manifest-lite for 2 specialists + no shared
    expect(fs.existsSync(path.join(projectRoot, "artifacts", "manifest-lite.yaml"))).toBe(false);
  });
});
