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

    it("needs_planner = true when tasks_md approved but stale_soft", () => {
      const manifest = addArtifact(createEmptyManifest("test"), {
        id: "tasks_md",
        family: "reference",
        path: "tasks.md",
        content_rev: 1,
        lifecycle: "approved",
        freshness: "stale_soft",
      });
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(true); // 설계: freshness must be fresh to skip planner
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

  describe("scope_match and replan_required (R-1)", () => {
    it("needs_planner = true when scope_match is false", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({ scope_match: false }));
      expect(result.needs_planner).toBe(true);
      expect(result.planner_card).toBeDefined();
    });

    it("needs_planner = false when scope_match is true (explicit)", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({ scope_match: true }));
      expect(result.needs_planner).toBe(false);
    });

    it("needs_planner = false when scope_match is omitted (stub default)", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest());
      expect(result.needs_planner).toBe(false);
    });

    it("needs_planner = true when replan_required is true", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({ replan_required: true }));
      expect(result.needs_planner).toBe(true);
    });

    it("needs_planner = false when replan_required is false", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({ replan_required: false }));
      expect(result.needs_planner).toBe(false);
    });

    it("scope_match=false overrides even when tasks_md is approved+fresh", () => {
      const manifest = manifestWithApprovedTasks();
      const result = evaluateDispatchRule(manifest, makeRequest({ scope_match: false }));
      expect(result.needs_planner).toBe(true);
    });
  });

import { evaluateTier2DispatchRule } from "../../src/engine/dispatch-rule.js";
import type { Brief } from "../../src/schemas/brief.js";

function makeBrief(overrides?: Partial<Brief>): Brief {
  return {
    brief_id: "test-brief",
    goal: "Test goal",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: ["src/auth/refresh.ts"] },
      { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes.ts"] },
    ],
    shared: [],
    accept_checks: ["build passes"],
    escalate_if: [],
    ...overrides,
  };
}

function manifestWithApprovedTasksT2(): ProjectManifest {
  return addArtifact(createEmptyManifest("test"), {
    id: "tasks_md",
    path: "artifacts/tasks.md",
    family: "reference",
    lifecycle: "approved",
    freshness: "fresh",
    content_rev: 1,
  });
}

describe("evaluateTier2DispatchRule", () => {
  const manifest = manifestWithApprovedTasksT2();
  const emptyManifest = createEmptyManifest("test");

  it("generates one card per specialist", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "auth refresh", write_scope: ["src/auth/", "src/api/"] },
      makeBrief(),
    );
    expect(result.specialist_cards).toHaveLength(2);
    expect(result.specialist_cards[0].role).toBe("specialist");
    expect(result.specialist_cards[1].role).toBe("specialist");
  });

  it("generates a reviewer card", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "auth refresh", write_scope: ["src/auth/", "src/api/"] },
      makeBrief(),
    );
    expect(result.reviewer_card.role).toBe("reviewer");
    expect(result.reviewer_card.tier).toBe(2);
    expect(result.reviewer_card.input_refs).toHaveLength(2);
  });

  it("reviewer input_refs match specialist card ids", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/"] },
      makeBrief(),
    );
    const specialistIds = result.specialist_cards.map((c) => c.id);
    expect(result.reviewer_card.input_refs).toEqual(specialistIds);
  });

  it("specialist cards reflect brief scope", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/auth/", "src/api/"] },
      makeBrief(),
    );
    expect(result.specialist_cards[0].write_scope).toEqual(["src/auth/"]);
    expect(result.specialist_cards[1].write_scope).toEqual(["src/api/"]);
  });

  it("includes shared_surface when brief has shared", () => {
    const brief = makeBrief({
      shared: ["src/types/auth.ts"],
      specialists: [
        { id: "specialist-1", scope: ["src/auth/"], owns: ["src/types/auth.ts"] },
        { id: "specialist-2", scope: ["src/api/"], owns: [] },
      ],
    });
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/auth/", "src/api/"] },
      brief,
    );
    expect(result.specialist_cards[0].shared_surface).toBeDefined();
    expect(result.specialist_cards[0].shared_surface![0].owner).toBe("specialist-1");
  });

  it("no shared_surface field when brief.shared is empty", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/"] },
      makeBrief(),
    );
    expect(result.specialist_cards[0].shared_surface).toBeUndefined();
  });

  it("generates planner card when tasks_md missing", () => {
    const result = evaluateTier2DispatchRule(
      emptyManifest,
      { task: "test", write_scope: ["src/"] },
      makeBrief(),
    );
    expect(result.needs_planner).toBe(true);
    expect(result.planner_card).toBeDefined();
    expect(result.planner_card!.role).toBe("planner");
    expect(result.planner_card!.tier).toBe(2);
  });

  it("skips planner when tasks_md exists and approved+fresh", () => {
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/auth/", "src/api/"] },
      makeBrief(),
    );
    expect(result.needs_planner).toBe(false);
    expect(result.planner_card).toBeUndefined();
  });

  it("generates 3 specialist cards for 3-specialist brief", () => {
    const brief = makeBrief({
      specialists: [
        { id: "s-1", scope: ["src/a/"], owns: [] },
        { id: "s-2", scope: ["src/b/"], owns: [] },
        { id: "s-3", scope: ["src/c/"], owns: [] },
      ],
    });
    const result = evaluateTier2DispatchRule(
      manifest,
      { task: "test", write_scope: ["src/a/", "src/b/", "src/c/"] },
      brief,
    );
    expect(result.specialist_cards).toHaveLength(3);
    expect(result.reviewer_card.input_refs).toHaveLength(3);
  });
});
