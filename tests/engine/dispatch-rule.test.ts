import { describe, it, expect } from "vitest";
import { evaluateDispatchRule, type TaskRequest } from "../../src/engine/dispatch-rule.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";
import { validateDispatchCard } from "../../src/schemas/dispatch-card.js";
import type { ProjectManifest } from "../../src/store/types.js";

function makeRequest(overrides?: Partial<TaskRequest>): TaskRequest {
  return {
    task: "Implement feature X",
    write_scope: ["src/feature.ts"],
    ...overrides,
  };
}

function manifestWithApprovedTasks(): ProjectManifest {
  return addArtifact(createEmptyManifest("test"), {
    id: "tasks_md",
    family: "reference",
    path: "tasks.md",
    content_rev: 1,
    lifecycle: "approved",
    freshness: "fresh",
  });
}

describe("evaluateDispatchRule", () => {
  describe("needs_planner determination", () => {
    it("needs_planner = true when no tasks_md artifact", () => {
      const manifest = createEmptyManifest("test");
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(true);
      expect(result.planner_card).toBeDefined();
    });

    it("needs_planner = true when tasks_md lifecycle is not approved", () => {
      const manifest = addArtifact(createEmptyManifest("test"), {
        id: "tasks_md",
        family: "reference",
        path: "tasks.md",
        content_rev: 1,
        lifecycle: "draft",
        freshness: "fresh",
      });
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(true);
    });

    it("needs_planner = true when tasks_md freshness is stale_hard", () => {
      const manifest = addArtifact(createEmptyManifest("test"), {
        id: "tasks_md",
        family: "reference",
        path: "tasks.md",
        content_rev: 1,
        lifecycle: "approved",
        freshness: "stale_hard",
      });
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(true);
    });

    it("needs_planner = false when tasks_md approved and fresh", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(false);
      expect(result.planner_card).toBeUndefined();
    });

    it("needs_planner = false when tasks_md approved and stale_soft", () => {
      const manifest = addArtifact(createEmptyManifest("test"), {
        id: "tasks_md",
        family: "reference",
        path: "tasks.md",
        content_rev: 1,
        lifecycle: "approved",
        freshness: "stale_soft",
      });
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(false);
    });
  });

  describe("dispatch card generation", () => {
    it("generates valid specialist dispatch card", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(() => validateDispatchCard(result.dispatch_card)).not.toThrow();
      expect(result.dispatch_card.role).toBe("specialist");
      expect(result.dispatch_card.task).toBe("Implement feature X");
      expect(result.dispatch_card.write_scope).toEqual(["src/feature.ts"]);
    });

    it("generates valid planner dispatch card when needed", () => {
      const manifest = createEmptyManifest("test");
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.planner_card).toBeDefined();
      expect(() => validateDispatchCard(result.planner_card!)).not.toThrow();
      expect(result.planner_card!.role).toBe("planner");
    });

    it("passes input_refs from request to cards", () => {
      const manifest = createEmptyManifest("test");
      const result = evaluateDispatchRule(manifest, makeRequest({
        input_refs: ["ref1", "ref2"],
      }));
      expect(result.dispatch_card.input_refs).toEqual(["ref1", "ref2"]);
      expect(result.planner_card!.input_refs).toEqual(["ref1", "ref2"]);
    });

    it("defaults input_refs to empty array", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.dispatch_card.input_refs).toEqual([]);
    });

    it("sets correct tier based on write_scope", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({
        write_scope: ["a", "b", "c", "d", "e", "f"],
      }));
      expect(result.dispatch_card.tier).toBe(2);
    });
  });
});
