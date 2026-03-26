import { describe, it, expect } from "vitest";
import { parseSpawnOutput, extractJSON, SpawnOutputParseError } from "../../src/runners/output-parser.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

function makeCard(role: DispatchCard["role"] = "specialist"): DispatchCard {
  return {
    version: 1, dispatch_rev: 1, role, id: "test-1", tier: 2,
    task: "test task", input_refs: [], entrypoint: [], must_read: [],
    authoritative_artifact: [], write_scope: [], completion_check: [],
    return_format: { schema: "test" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };
}

const validSpecialist = JSON.stringify({
  status: "done",
  touched_files: ["src/a.ts"],
  changeset: "changes",
  delta_stub: "// delta",
  evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
});

const validPlanner = JSON.stringify({ tasks_md: "# Plan\n- step 1" });

const validReviewer = JSON.stringify({
  review_report: "All good",
  disposition_recommendation: "PASS",
  issues: [],
});

const validLead = JSON.stringify({
  final_merge_candidate: true,
  execution_summary: "Lead done",
  specialist_results: [{
    status: "done", touched_files: [], changeset: "c", delta_stub: "d",
    evidence: { build_pass: true, test_pass: true, test_summary: "ok" },
  }],
  manifest_updates: { base_manifest_seq: 1, apply_mode: "all_or_fail", patches: [{ artifact_id: "a1", op: "set", field: "lifecycle", new_value: "approved", reason: "done" }] },
});

describe("extractJSON", () => {
  it("pure JSON string", () => {
    const result = extractJSON(validSpecialist);
    expect(JSON.parse(result)).toHaveProperty("status");
  });

  it("fenced json block with surrounding text", () => {
    const raw = `Here is the result:\n\n\`\`\`json\n${validSpecialist}\n\`\`\`\n\nDone.`;
    const result = extractJSON(raw);
    expect(JSON.parse(result)).toHaveProperty("status");
  });

  it("text + JSON mixed — extracts last braced block", () => {
    const raw = `Some intro text\nresult: ${validSpecialist}`;
    const result = extractJSON(raw);
    expect(JSON.parse(result)).toHaveProperty("status");
  });

  it("no valid JSON → throws", () => {
    expect(() => extractJSON("no json here")).toThrow(SpawnOutputParseError);
  });
});

describe("parseSpawnOutput", () => {
  it("specialist: valid JSON → parsed", () => {
    const result = parseSpawnOutput(makeCard("specialist"), validSpecialist);
    expect((result as any).status).toBe("done");
  });

  it("planner: valid JSON → parsed", () => {
    const result = parseSpawnOutput(makeCard("planner"), validPlanner);
    expect((result as any).tasks_md).toContain("Plan");
  });

  it("reviewer: valid JSON → parsed", () => {
    const result = parseSpawnOutput(makeCard("reviewer"), validReviewer);
    expect((result as any).disposition_recommendation).toBe("PASS");
  });

  it("execution_lead: valid JSON → parsed", () => {
    const result = parseSpawnOutput(makeCard("execution_lead"), validLead);
    expect((result as any).final_merge_candidate).toBe(true);
  });

  it("planner: missing required field → SpawnOutputParseError with zodErrors", () => {
    try {
      parseSpawnOutput(makeCard("planner"), JSON.stringify({ no_tasks: true }));
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SpawnOutputParseError);
      expect((e as SpawnOutputParseError).zodErrors).toBeDefined();
    }
  });

  it("empty output → SpawnOutputParseError", () => {
    expect(() => parseSpawnOutput(makeCard(), "")).toThrow(SpawnOutputParseError);
  });

  it("invalid JSON → SpawnOutputParseError", () => {
    expect(() => parseSpawnOutput(makeCard(), "not json {{{")).toThrow(SpawnOutputParseError);
  });

  it("shared_owner uses SpecialistSubmission schema", () => {
    const result = parseSpawnOutput(makeCard("shared_owner"), validSpecialist);
    expect((result as any).status).toBe("done");
  });

  it("fenced json block is extracted and validated", () => {
    const raw = `Processing...\n\n\`\`\`json\n${validSpecialist}\n\`\`\`\n\nComplete.`;
    const result = parseSpawnOutput(makeCard("specialist"), raw);
    expect((result as any).status).toBe("done");
  });
});
