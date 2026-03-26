import { describe, it, expect } from "vitest";
import { buildTaskTemplate, buildReturnInstruction } from "../../src/runners/task-template.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

function makeCard(overrides: Partial<DispatchCard> = {}): DispatchCard {
  return {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id: "spec-1",
    tier: 2,
    task: "Implement feature X",
    input_refs: [],
    entrypoint: ["src/index.ts"],
    must_read: ["src/types.ts"],
    authoritative_artifact: [],
    write_scope: ["src/feature.ts"],
    completion_check: ["tests pass", "tsc clean"],
    return_format: { schema: "SpecialistSubmission" },
    timeout_profile: { class: "standard", heartbeat_required: false },
    ...overrides,
  };
}

describe("buildTaskTemplate", () => {
  const config = {
    projectPath: "~/projects/test",
    designDocPaths: ["/docs/design.md"],
  };

  it("planner: includes projectPath, designDocPaths, and planning instructions", () => {
    const card = makeCard({ role: "planner", task: "Plan the refactor" });
    const template = buildTaskTemplate(card, config);
    expect(template).toContain("시니어 소프트웨어 아키텍트");
    expect(template).toContain("~/projects/test");
    expect(template).toContain("/docs/design.md");
    expect(template).toContain("Plan the refactor");
    expect(template).toContain("tasks_md");
  });

  it("specialist: includes write_scope, forbidden_paths, and test command", () => {
    const card = makeCard({
      forbidden_paths: ["src/secret.ts"],
      write_scope: ["src/feature.ts", "src/util.ts"],
    });
    const template = buildTaskTemplate(card, config);
    expect(template).toContain("시니어 TypeScript 개발자");
    expect(template).toContain("src/feature.ts");
    expect(template).toContain("src/secret.ts");
    expect(template).toContain("npx vitest run");
  });

  it("reviewer: includes 'do not modify code' instruction", () => {
    const card = makeCard({
      role: "reviewer",
      input_refs: ["changeset-1", "changeset-2"],
    });
    const template = buildTaskTemplate(card, config);
    expect(template).toContain("코드를 수정하지 않는다");
    expect(template).toContain("changeset-1");
    expect(template).toContain("disposition_recommendation");
  });

  it("execution_lead: includes specialist_assignments and active_span", () => {
    const card = makeCard({
      role: "execution_lead",
      specialist_assignments: [
        { specialist_id: "s1", task: "impl", shared_owner: false, priority: 1 },
      ],
      active_span: 3,
    });
    const template = buildTaskTemplate(card, config);
    expect(template).toContain("execution lead");
    expect(template).toContain('"s1"');
    expect(template).toContain("Active span: 3");
  });

  it("shared_owner: includes priority_task", () => {
    const card = makeCard({
      role: "shared_owner",
      priority_task: "Update shared interfaces first",
    });
    const template = buildTaskTemplate(card, config);
    expect(template).toContain("shared surface 관리");
    expect(template).toContain("Update shared interfaces first");
  });

  it("handles empty optional fields gracefully", () => {
    const card = makeCard({
      forbidden_paths: undefined,
      must_read: [],
      authoritative_artifact: [],
    });
    const template = buildTaskTemplate(card, config);
    expect(template).not.toContain("금지 경로");
    expect(template).not.toContain("읽어야 할 파일");
    expect(template).not.toContain("권위적 산출물");
  });

  it("return instruction matches role schema", () => {
    const plannerInstruction = buildReturnInstruction(makeCard({ role: "planner" }));
    expect(plannerInstruction).toContain("tasks_md");

    const reviewerInstruction = buildReturnInstruction(makeCard({ role: "reviewer" }));
    expect(reviewerInstruction).toContain("disposition_recommendation");

    const leadInstruction = buildReturnInstruction(makeCard({ role: "execution_lead" }));
    expect(leadInstruction).toContain("final_merge_candidate");
  });
});
