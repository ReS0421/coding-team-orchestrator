import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createSpawnAdapter, type SpawnOptions, type SpawnResult } from "../../src/runners/spawn-adapter.js";
import { runTier1, type OrchestratorConfig } from "../../src/engine/orchestrator-tier1.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

describe("Tier 1 dry-run integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-dryrun-"));
    // Create minimal project structure
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Project\n");
    fs.mkdirSync(path.join(tmpDir, ".store"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full Tier 1 flow with real adapter + fake spawn", async () => {
    const spawnCalls: Array<{ task: string; options: SpawnOptions }> = [];

    const fakeSpawn = async (task: string, options: SpawnOptions): Promise<SpawnResult> => {
      spawnCalls.push({ task, options });

      // Planner return (if planner is called)
      if (task.includes("아키텍트")) {
        return {
          success: true,
          output: JSON.stringify({
            tasks_md: "## Tasks\n- Update README",
            tier_recommendation: 1,
          }),
        };
      }

      // Specialist return
      return {
        success: true,
        output: JSON.stringify({
          status: "done",
          touched_files: ["README.md"],
          changeset: "Updated README with Sprint 6 info",
          delta_stub: "// README update",
          evidence: { build_pass: true, test_pass: true, test_summary: "N/A for docs" },
        }),
      };
    };

    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: tmpDir },
    });

    // Run Tier 1
    const config: OrchestratorConfig = {
      projectRoot: tmpDir,
      logDir: path.join(tmpDir, ".store"),
      runner,
    };

    const result = await runTier1(config, {
      task: "Update README.md with Sprint 6 completion info",
      write_scope: ["README.md"],
    });

    expect(result.success).toBe(true);
    expect(spawnCalls.length).toBeGreaterThan(0);
    // At least one spawn should be acp (specialist)
    expect(spawnCalls.some(c => c.options.runtime === "acp")).toBe(true);
  });

  it("Tier 1 with spawn failure → retry → success", async () => {
    let callCount = 0;

    const fakeSpawn = async (task: string, options: SpawnOptions): Promise<SpawnResult> => {
      callCount++;

      if (task.includes("아키텍트")) {
        return {
          success: true,
          output: JSON.stringify({
            tasks_md: "## Tasks\n- Fix bug",
            tier_recommendation: 1,
          }),
        };
      }

      // First specialist call fails, second succeeds
      if (callCount <= 2) {
        return { success: false, error: "temporary timeout" };
      }
      return {
        success: true,
        output: JSON.stringify({
          status: "done",
          touched_files: ["src/fix.ts"],
          changeset: "Bug fix applied",
          delta_stub: "// fix",
          evidence: { build_pass: true, test_pass: true, test_summary: "1 test pass" },
        }),
      };
    };

    const runner = createSpawnAdapter({
      mode: "real",
      realConfig: { spawn: fakeSpawn, projectPath: tmpDir, defaultRetries: 2 },
    });

    const config: OrchestratorConfig = {
      projectRoot: tmpDir,
      logDir: path.join(tmpDir, ".store"),
      runner,
    };

    const result = await runTier1(config, {
      task: "Fix the bug in src/fix.ts",
      write_scope: ["src/fix.ts"],
    });

    expect(result.success).toBe(true);
  });
});
