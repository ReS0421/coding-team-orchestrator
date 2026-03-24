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

describe("judgeTier - Tier 2 specifics", () => {
  it("returns Tier 2 with 2 controllable shared surfaces", () => {
    expect(
      judgeTier({
        write_scope: ["a.ts", "b.ts"],
        shared_surfaces: [
          { path: "shared1.ts", rule: "lock", owner: "s-1" },
          { path: "shared2.ts", rule: "lock", owner: "s-2" },
        ],
        specialist_count: 2,
      }),
    ).toBe(Tier.TWO);
  });

  it("returns Tier 2 with specialist_count = 3", () => {
    expect(
      judgeTier({ write_scope: Array.from({ length: 10 }, (_, i) => `f${i}.ts`), specialist_count: 3 }),
    ).toBe(Tier.TWO);
  });

  it("returns Tier 2 with write_scope = 20 (boundary)", () => {
    expect(
      judgeTier({ write_scope: Array.from({ length: 20 }, (_, i) => `f${i}.ts`), specialist_count: 2 }),
    ).toBe(Tier.TWO);
  });
});

describe("judgeTier - Tier 3 guard", () => {
  it("throws for 3+ shared surfaces", () => {
    expect(() =>
      judgeTier({
        write_scope: ["a.ts"],
        shared_surfaces: [
          { path: "s1.ts", rule: "r", owner: "o1" },
          { path: "s2.ts", rule: "r", owner: "o2" },
          { path: "s3.ts", rule: "r", owner: "o3" },
        ],
      }),
    ).toThrow("Tier 3 not supported yet");
  });

  it("throws for uncontrollable shared surface", () => {
    expect(() =>
      judgeTier({
        write_scope: ["a.ts"],
        shared_surfaces: [
          { path: "s1.ts", rule: "r", owner: "o1", controllable: false },
        ],
      }),
    ).toThrow("uncontrollable");
  });

  it("throws for shared surface without owner", () => {
    expect(() =>
      judgeTier({
        write_scope: ["a.ts"],
        shared_surfaces: [
          { path: "s1.ts", rule: "r", owner: "" },
        ],
      }),
    ).toThrow("without owner");
  });

  it("throws for specialist_count > 3", () => {
    expect(() =>
      judgeTier({ write_scope: ["a.ts"], specialist_count: 4 }),
    ).toThrow("Tier 3 not supported yet");
  });

  it("throws for write_scope > 20", () => {
    expect(() =>
      judgeTier({ write_scope: Array.from({ length: 21 }, (_, i) => `f${i}.ts`), specialist_count: 2 }),
    ).toThrow("Tier 3 not supported yet");
  });
});
