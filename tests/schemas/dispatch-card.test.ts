import { describe, it, expect } from "vitest";
import { validateDispatchCard } from "../../src/schemas/dispatch-card.js";

const validCard = {
  version: 1,
  dispatch_rev: 1,
  role: "specialist",
  id: "specialist-1",
  tier: 2,
  task: "src/auth/ 모듈 구현",
  input_refs: ["tasks.md@rev3"],
  entrypoint: ["dispatch/specialist-1.md"],
  must_read: ["tasks.md@rev3"],
  authoritative_artifact: ["tasks.md@rev3"],
  write_scope: ["src/auth/**"],
  completion_check: ["spec §3 수락 기준 충족"],
  return_format: { schema: "specialist_submission_v1" },
  timeout_profile: { class: "standard", heartbeat_required: false },
};

describe("DispatchCard - valid", () => {
  it("parses a minimal valid card", () => {
    const result = validateDispatchCard(validCard);
    expect(result.role).toBe("specialist");
    expect(result.tier).toBe(2);
    expect(result.dispatch_rev).toBe(1);
  });
  it("allows optional fields", () => {
    const withOptionals = {
      ...validCard,
      forbidden_paths: ["src/db/**"],
      shared_surface: [{ path: "src/types/auth.ts", rule: "tier_shared_protocol", owner: "specialist-1" }],
    };
    expect(() => validateDispatchCard(withOptionals)).not.toThrow();
  });
  it("accepts all valid roles", () => {
    for (const role of ["planner", "specialist", "execution_lead", "shared_owner", "reviewer"]) {
      expect(() => validateDispatchCard({ ...validCard, role })).not.toThrow();
    }
  });
  it("accepts all valid timeout classes", () => {
    for (const cls of ["quick", "standard", "extended", "unlimited"]) {
      expect(() => validateDispatchCard({
        ...validCard,
        timeout_profile: { class: cls, heartbeat_required: false },
      })).not.toThrow();
    }
  });
});

describe("DispatchCard - invalid", () => {
  it("rejects missing required fields", () => {
    expect(() => validateDispatchCard({ ...validCard, role: undefined })).toThrow();
  });
  it("rejects invalid role value", () => {
    expect(() => validateDispatchCard({ ...validCard, role: "boss" })).toThrow();
  });
  it("rejects invalid tier", () => {
    expect(() => validateDispatchCard({ ...validCard, tier: 4 })).toThrow();
  });
  it("rejects version !== 1", () => {
    expect(() => validateDispatchCard({ ...validCard, version: 2 })).toThrow();
  });
  it("rejects string dispatch_rev", () => {
    expect(() => validateDispatchCard({ ...validCard, dispatch_rev: "v1" })).toThrow();
  });
  it("rejects string entrypoint (should be array)", () => {
    expect(() => validateDispatchCard({ ...validCard, entrypoint: "single" })).toThrow();
  });
});

// ─── Sprint 3: shared protocol fields ──────────────────

describe("DispatchCard - shared protocol fields", () => {
  it("accepts controllable in shared_surface", () => {
    const card = {
      ...validCard,
      shared_surface: [
        { path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1", controllable: true },
      ],
    };
    const result = validateDispatchCard(card);
    expect(result.shared_surface![0].controllable).toBe(true);
  });

  it("accepts controllable=false in shared_surface", () => {
    const card = {
      ...validCard,
      shared_surface: [
        { path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1", controllable: false },
      ],
    };
    const result = validateDispatchCard(card);
    expect(result.shared_surface![0].controllable).toBe(false);
  });

  it("controllable defaults to undefined (optional)", () => {
    const card = {
      ...validCard,
      shared_surface: [
        { path: "src/types/auth.ts", rule: "tier2_shared_protocol", owner: "specialist-1" },
      ],
    };
    const result = validateDispatchCard(card);
    expect(result.shared_surface![0].controllable).toBeUndefined();
  });

  it("accepts priority_task, selective_hold, spawn_order", () => {
    const card = {
      ...validCard,
      priority_task: "Implement shared interface changes first: src/types/auth.ts",
      selective_hold: true,
      spawn_order: 2,
    };
    const result = validateDispatchCard(card);
    expect(result.priority_task).toContain("shared interface");
    expect(result.selective_hold).toBe(true);
    expect(result.spawn_order).toBe(2);
  });

  it("accepts is_acting_lead and is_shared_owner on specialist", () => {
    const card = {
      ...validCard,
      role: "specialist",
      is_acting_lead: true,
      is_shared_owner: true,
    };
    const result = validateDispatchCard(card);
    expect(result.is_acting_lead).toBe(true);
    expect(result.is_shared_owner).toBe(true);
    expect(result.role).toBe("specialist");
  });
});
