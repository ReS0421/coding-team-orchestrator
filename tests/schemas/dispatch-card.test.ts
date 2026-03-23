import { describe, it, expect } from "vitest";
import {
  DispatchCardSchema,
  validateDispatchCard,
  safeValidateDispatchCard,
} from "../../src/schemas/dispatch-card.js";

const validCard = {
  version: 1,
  dispatch_rev: "rev-001",
  role: "specialist",
  id: "card-001",
  tier: 2,
  task: "Implement feature X",
  input_refs: ["ref-a", "ref-b"],
  entrypoint: "src/feature-x/index.ts",
  must_read: ["docs/spec.md"],
  authoritative_artifact: "artifact-001",
  write_scope: ["src/feature-x/"],
  completion_check: "npm test",
  return_format: { schema: "specialist-submission" },
  timeout_profile: { class: "medium", heartbeat_required: true },
};

describe("DispatchCardSchema", () => {
  it("accepts a valid dispatch card", () => {
    const result = DispatchCardSchema.safeParse(validCard);
    expect(result.success).toBe(true);
  });

  it("accepts card with optional fields", () => {
    const card = {
      ...validCard,
      forbidden_paths: ["/etc/secret"],
      shared_surface: [{ path: "shared/state.json", rule: "append-only", owner: "lead" }],
    };
    const result = DispatchCardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it("rejects wrong version", () => {
    const result = DispatchCardSchema.safeParse({ ...validCard, version: 2 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = DispatchCardSchema.safeParse({ ...validCard, role: "admin" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid tier", () => {
    const result = DispatchCardSchema.safeParse({ ...validCard, tier: 4 });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { task, ...incomplete } = validCard;
    const result = DispatchCardSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("validateDispatchCard returns parsed data", () => {
    const parsed = validateDispatchCard(validCard);
    expect(parsed.id).toBe("card-001");
  });

  it("validateDispatchCard throws on invalid data", () => {
    expect(() => validateDispatchCard({ version: 1 })).toThrow();
  });

  it("safeValidateDispatchCard returns success result", () => {
    const result = safeValidateDispatchCard(validCard);
    expect(result.success).toBe(true);
  });

  it("safeValidateDispatchCard returns error result without throwing", () => {
    const result = safeValidateDispatchCard({});
    expect(result.success).toBe(false);
  });
});
