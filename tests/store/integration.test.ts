import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEmptyManifest,
  addArtifact,
  saveManifest,
  loadManifest,
  incrementContentRev,
  propagateFreshness,
  applyPatchSet,
  createCheckpoint,
  restoreFromCheckpoint,
  appendEventLog,
  appendErrorLog,
  readNdjson,
} from "../../src/store/index.js";
import {
  ArtifactFamily,
  ChangeClass,
  Freshness,
  Lifecycle,
  ControlState,
} from "../../src/domain/types.js";
import type { ManifestPatchSet } from "../../src/schemas/manifest-patch.js";
import type { ErrorLog } from "../../src/schemas/error-log.js";

describe("store integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-integration-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scenario 1: patch → seq increase → freshness propagation (file-based save/load)", () => {
    // Setup manifest with dependencies
    let m = createEmptyManifest("integration-1");
    m = addArtifact(m, {
      id: "architecture",
      family: ArtifactFamily.REFERENCE,
      path: "architecture.md",
      content_rev: 1,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
    });
    m = addArtifact(m, {
      id: "spec",
      family: ArtifactFamily.REFERENCE,
      path: "spec.md",
      content_rev: 2,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
      depends_on: ["architecture"],
    });
    m = addArtifact(m, {
      id: "exec-contract",
      family: ArtifactFamily.CONTROL,
      path: "exec-contract.md",
      content_rev: 1,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
      control_state: ControlState.ACTIVE,
      depends_on: ["architecture"],
    });

    // Save to disk
    saveManifest(tmpDir, m);

    // Load from disk
    let loaded = loadManifest(tmpDir);
    expect(loaded.manifest_seq).toBe(0);

    // Increment content_rev on architecture (structural change)
    loaded = incrementContentRev(
      loaded, "architecture", ChangeClass.STRUCTURAL,
      "module restructure", "2026-03-21T14:00:00Z",
    );
    expect(loaded.manifest_seq).toBe(1);
    expect(loaded.artifacts[0].content_rev).toBe(2);

    // Propagate freshness
    loaded = propagateFreshness(loaded, "architecture", ChangeClass.STRUCTURAL);
    const spec = loaded.artifacts.find((a) => a.id === "spec")!;
    const contract = loaded.artifacts.find((a) => a.id === "exec-contract")!;
    expect(spec.freshness).toBe(Freshness.STALE_SOFT);
    expect(contract.freshness).toBe(Freshness.STALE_HARD);

    // Save and reload
    saveManifest(tmpDir, loaded);
    const reloaded = loadManifest(tmpDir);
    expect(reloaded.manifest_seq).toBe(1);
    expect(reloaded.transitions).toHaveLength(1);
    expect(reloaded.artifacts.find((a) => a.id === "spec")!.freshness).toBe("stale_soft");
    expect(reloaded.artifacts.find((a) => a.id === "exec-contract")!.freshness).toBe("stale_hard");
  });

  it("scenario 2: optimistic concurrency reject", () => {
    let m = createEmptyManifest("integration-2");
    m = addArtifact(m, {
      id: "spec",
      family: ArtifactFamily.REFERENCE,
      path: "spec.md",
      content_rev: 1,
      freshness: Freshness.FRESH,
    });

    // Simulate two concurrent patch sets with stale base_manifest_seq
    const patchSet1: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "spec",
        op: "set",
        field: "freshness",
        old_value: "fresh",
        new_value: "stale_soft",
        reason: "first writer",
      }],
    };
    const result1 = applyPatchSet(m, patchSet1);
    expect(result1.success).toBe(true);
    expect(result1.manifest.manifest_seq).toBe(1);

    // Second writer has stale base_manifest_seq=0
    const patchSet2: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [{
        artifact_id: "spec",
        op: "set",
        field: "freshness",
        old_value: "fresh",
        new_value: "stale_hard",
        reason: "second writer (stale)",
      }],
    };
    const result2 = applyPatchSet(result1.manifest, patchSet2);
    expect(result2.success).toBe(false);
    expect(result2.errors[0]).toContain("seq mismatch");
  });

  it("scenario 3: all_or_fail rollback", () => {
    let m = createEmptyManifest("integration-3");
    m = addArtifact(m, {
      id: "spec",
      family: ArtifactFamily.REFERENCE,
      path: "spec.md",
      content_rev: 1,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
    });
    m = addArtifact(m, {
      id: "tasks",
      family: ArtifactFamily.REFERENCE,
      path: "tasks.md",
      content_rev: 1,
      lifecycle: Lifecycle.DRAFT,
      freshness: Freshness.FRESH,
    });

    const patchSet: ManifestPatchSet = {
      base_manifest_seq: 0,
      apply_mode: "all_or_fail",
      patches: [
        {
          artifact_id: "spec",
          op: "set",
          field: "freshness",
          old_value: "fresh",
          new_value: "stale_soft",
          reason: "valid",
        },
        {
          artifact_id: "tasks",
          op: "set",
          field: "lifecycle",
          old_value: "approved", // wrong — it's "draft"
          new_value: "proposed",
          reason: "invalid — wrong old_value",
        },
      ],
    };
    const result = applyPatchSet(m, patchSet);
    expect(result.success).toBe(false);
    // Both fields remain unchanged
    expect(result.manifest.artifacts[0].freshness).toBe("fresh");
    expect(result.manifest.artifacts[1].lifecycle).toBe("draft");
    expect(result.manifest.manifest_seq).toBe(0);
  });

  it("scenario 4: checkpoint create and restore", () => {
    let m = createEmptyManifest("integration-4");
    m = addArtifact(m, {
      id: "spec",
      family: ArtifactFamily.REFERENCE,
      path: "spec.md",
      content_rev: 1,
      lifecycle: Lifecycle.APPROVED,
      freshness: Freshness.FRESH,
    });

    // Create checkpoint
    m = createCheckpoint(m, "2026-03-21T15:00:00Z");
    expect(m.checkpoints).toHaveLength(1);
    expect(m.manifest_seq).toBe(1);

    // Make changes after checkpoint
    m = incrementContentRev(
      m, "spec", ChangeClass.STRUCTURAL,
      "big restructure", "2026-03-21T16:00:00Z",
    );
    expect(m.artifacts[0].content_rev).toBe(2);
    expect(m.manifest_seq).toBe(2);

    // Save and reload
    saveManifest(tmpDir, m);
    let loaded = loadManifest(tmpDir);

    // Restore from checkpoint
    loaded = restoreFromCheckpoint(
      loaded, "cp-1", "reverting restructure", "2026-03-21T17:00:00Z",
    );
    expect(loaded.artifacts[0].content_rev).toBe(1); // restored
    expect(loaded.artifacts[0].freshness).toBe("fresh"); // restored
    expect(loaded.manifest_seq).toBe(3);
    expect(loaded.transitions.some((t) => t.reason.includes("Rollback"))).toBe(true);
  });

  it("scenario 5: NDJSON event and error logging", () => {
    const logDir = path.join(tmpDir, "logs");

    // Write events
    appendEventLog(
      { type: "patch_applied", manifest_seq: 1, timestamp: "2026-03-21T14:00:00Z" },
      { logDir },
    );
    appendEventLog(
      { type: "freshness_propagated", affected: ["spec", "tasks"], timestamp: "2026-03-21T14:01:00Z" },
      { logDir },
    );

    // Write error
    const errorEntry: ErrorLog = {
      session_id: "sess-42",
      role: "specialist",
      error_type: "timeout",
      timestamp: "2026-03-21T14:05:00Z",
      dispatch_rev: 3,
      retry_count: 1,
      propagation_class: "contained",
      affected_tasks: ["task-7"],
      artifact_refs: ["spec"],
      notes: "specialist timed out on complex task",
    };
    appendErrorLog(errorEntry, { logDir });

    // Read back
    const events = readNdjson(path.join(logDir, "events.ndjson"));
    expect(events).toHaveLength(2);
    expect((events[0] as Record<string, unknown>)["type"]).toBe("patch_applied");

    const errors = readNdjson<ErrorLog>(path.join(logDir, "errors.ndjson"));
    expect(errors).toHaveLength(1);
    expect(errors[0].session_id).toBe("sess-42");
    expect(errors[0].notes).toContain("timed out");
  });
});
