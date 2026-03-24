import { describe, it, expect } from "vitest";
import { validateBrief, safeValidateBrief } from "../../src/schemas/brief.js";

function validBrief() {
  return {
    brief_id: "feature-auth-refresh",
    goal: "인증 토큰 갱신 로직 추가",
    out_of_scope: ["DB schema 변경"],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: ["src/auth/refresh.ts"] },
      { id: "specialist-2", scope: ["src/api/"], owns: ["src/api/routes/auth.ts"] },
    ],
    shared: [],
    accept_checks: ["build passes", "auth refresh works"],
    escalate_if: ["shared files 3개 이상"],
  };
}

describe("BriefSchema", () => {
  it("validates a correct brief", () => {
    const result = safeValidateBrief(validBrief());
    expect(result.success).toBe(true);
  });

  it("validates brief with shared surfaces", () => {
    const brief = { ...validBrief(), shared: ["src/types/auth.ts"] };
    const result = safeValidateBrief(brief);
    expect(result.success).toBe(true);
  });

  it("rejects missing brief_id", () => {
    const { brief_id: _, ...rest } = validBrief();
    expect(safeValidateBrief(rest).success).toBe(false);
  });

  it("rejects empty brief_id", () => {
    expect(safeValidateBrief({ ...validBrief(), brief_id: "" }).success).toBe(false);
  });

  it("rejects missing goal", () => {
    const { goal: _, ...rest } = validBrief();
    expect(safeValidateBrief(rest).success).toBe(false);
  });

  it("rejects empty specialists array", () => {
    expect(safeValidateBrief({ ...validBrief(), specialists: [] }).success).toBe(false);
  });

  it("rejects specialist with empty scope", () => {
    const brief = {
      ...validBrief(),
      specialists: [{ id: "s-1", scope: [], owns: [] }],
    };
    expect(safeValidateBrief(brief).success).toBe(false);
  });

  it("rejects specialist with empty id", () => {
    const brief = {
      ...validBrief(),
      specialists: [{ id: "", scope: ["src/"], owns: [] }],
    };
    expect(safeValidateBrief(brief).success).toBe(false);
  });

  it("rejects empty accept_checks", () => {
    expect(safeValidateBrief({ ...validBrief(), accept_checks: [] }).success).toBe(false);
  });

  it("allows empty out_of_scope", () => {
    expect(safeValidateBrief({ ...validBrief(), out_of_scope: [] }).success).toBe(true);
  });

  it("allows empty escalate_if", () => {
    expect(safeValidateBrief({ ...validBrief(), escalate_if: [] }).success).toBe(true);
  });

  it("parse throws on invalid data", () => {
    expect(() => validateBrief({})).toThrow();
  });
});
