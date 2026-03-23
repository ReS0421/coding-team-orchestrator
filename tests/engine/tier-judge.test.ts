import { describe, it, expect } from "vitest";
import { judgeTier } from "../../src/engine/tier-judge.js";
import { Tier } from "../../src/domain/types.js";

describe("judgeTier", () => {
  it("returns Tier 1 for no shared surfaces and small scope", () => {
    expect(
      judgeTier({ write_scope: ["src/a.ts", "src/b.ts"] }),
    ).toBe(Tier.ONE);
  });

  it("returns Tier 1 with empty shared_surfaces array", () => {
    expect(
      judgeTier({ write_scope: ["a.ts"], shared_surfaces: [] }),
    ).toBe(Tier.ONE);
  });

  it("returns Tier 1 with specialist_count = 1 explicitly", () => {
    expect(
      judgeTier({ write_scope: ["a.ts"], specialist_count: 1 }),
    ).toBe(Tier.ONE);
  });

  it("returns Tier 2 when shared_surfaces present", () => {
    expect(
      judgeTier({
        write_scope: ["a.ts"],
        shared_surfaces: [{ path: "shared.ts", rule: "lock", owner: "team-a" }],
      }),
    ).toBe(Tier.TWO);
  });

  it("returns Tier 2 when specialist_count > 1", () => {
    expect(
      judgeTier({ write_scope: ["a.ts"], specialist_count: 2 }),
    ).toBe(Tier.TWO);
  });

  it("returns Tier 2 when write_scope > 5", () => {
    expect(
      judgeTier({ write_scope: ["a", "b", "c", "d", "e", "f"] }),
    ).toBe(Tier.TWO);
  });

  it("returns Tier 1 at exact boundary: write_scope = 5", () => {
    expect(
      judgeTier({ write_scope: ["a", "b", "c", "d", "e"] }),
    ).toBe(Tier.ONE);
  });

  it("returns Tier 2 when multiple conditions fail", () => {
    expect(
      judgeTier({
        write_scope: ["a", "b", "c", "d", "e", "f"],
        shared_surfaces: [{ path: "x", rule: "r", owner: "o" }],
        specialist_count: 3,
      }),
    ).toBe(Tier.TWO);
  });

  it("defaults specialist_count to 1 when omitted", () => {
    expect(
      judgeTier({ write_scope: [] }),
    ).toBe(Tier.ONE);
  });
});
