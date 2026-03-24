import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTier2, type Tier2Config } from "../../src/engine/orchestrator.js";
import { createEmptyManifest, addArtifact, saveManifest } from "../../src/store/manifest.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

describe("Tier 2 Shared Redispatch", () => {
  let projectRoot: string;
  let logDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tier2-redispatch-"));
    logDir = path.join(projectRoot, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const manifest = addArtifact(createEmptyManifest("test"), {
      id: "tasks_md", path: "artifacts/tasks.md", family: "reference",
      lifecycle: "approved", freshness: "fresh", content_rev: 1,
    });
    saveManifest(projectRoot, manifest);
  });

  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const brief: Brief = {
    brief_id: "redispatch-test",
    goal: "Test", out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
      { id: "specialist-2", scope: ["src/api/"], owns: [] },
    ],
    shared: ["src/types/auth.ts"],
    accept_checks: ["build"], escalate_if: [],
  };

  it("consumer BLOCKED → owner re-dispatch → consumer succeeds → PASS", async () => {
    const consumerCalls = new Map<string, number>();
    const runner: RunnerFn = async (card: DispatchCard) => {
      if (card.role === "planner") return { tasks_md: "# tasks" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
      };
      // Owner always succeeds
      if (card.is_shared_owner) return {
        status: "done" as const, touched_files: ["src/types/auth.ts"],
        changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
      // Consumer: first blocked, then done
      const key = card.id;
      const count = (consumerCalls.get(key) ?? 0) + 1;
      consumerCalls.set(key, count);
      if (count === 1) {
        return {
          status: "blocked" as const, touched_files: [],
          changeset: "x", delta_stub: "x",
          evidence: { build_pass: false, test_pass: false, test_summary: "blocked" },
          blocked_on: { reason: "shared_pending" as const, surface: "src/types/auth.ts", owner_id: "specialist-1" },
        };
      }
      return {
        status: "done" as const, touched_files: ["src/api/routes.ts"],
        changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }] },
    );

    expect(result.success).toBe(true);
    expect(result.shared_changes).toBeGreaterThan(0);
  });

  it("owner unexpected amendment + consumer normal", async () => {
    const runner: RunnerFn = async (card: DispatchCard) => {
      if (card.role === "planner") return { tasks_md: "# tasks" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
      };
      if (card.is_shared_owner) return {
        status: "done" as const, touched_files: ["src/types/auth.ts"],
        changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
        shared_amendment_flag: true,
      };
      return {
        status: "done" as const, touched_files: ["src/api/routes.ts"],
        changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }] },
    );

    expect(result.success).toBe(true);
  });

  it("owner crash → retry → success → consumer proceeds", async () => {
    let ownerCalls = 0;
    const runner: RunnerFn = async (card: DispatchCard) => {
      if (card.role === "planner") return { tasks_md: "# tasks" };
      if (card.role === "reviewer") return {
        review_report: "ok", disposition_recommendation: "PASS" as const, issues: [],
      };
      if (card.is_shared_owner) {
        ownerCalls++;
        if (ownerCalls === 1) throw new Error("owner crash");
        return {
          status: "done" as const, touched_files: ["src/types/auth.ts"],
          changeset: "c", delta_stub: "d",
          evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
        };
      }
      return {
        status: "done" as const, touched_files: ["src/api/routes.ts"],
        changeset: "c", delta_stub: "d",
        evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
      };
    };

    const result = await runTier2(
      { projectRoot, logDir, runner },
      { task: "test", write_scope: ["src/auth/", "src/api/"], brief,
        shared_surfaces: [{ path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" }] },
    );

    expect(result.success).toBe(true);
    expect(ownerCalls).toBe(2);
  });
});
