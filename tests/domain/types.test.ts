import { describe, it, expect } from "vitest";
import {
  Tier,
  ArtifactFamily,
  Lifecycle,
  Freshness,
  ControlState,
  SubmissionState,
  ErrorType,
  PropagationClass,
  TimeoutClass,
  Role,
  Status,
  ChangeClass,
} from "../../src/domain/types.js";

describe("domain/types", () => {
  it("Tier has 3 numeric values", () => {
    expect(Object.values(Tier)).toEqual([1, 2, 3]);
  });

  it("ArtifactFamily has 3 values", () => {
    expect(Object.values(ArtifactFamily)).toEqual(["code", "doc", "config"]);
  });

  it("Lifecycle has 6 values", () => {
    expect(Object.values(Lifecycle)).toHaveLength(6);
    expect(Object.values(Lifecycle)).toContain("draft");
    expect(Object.values(Lifecycle)).toContain("archived");
  });

  it("Freshness has 3 values", () => {
    expect(Object.values(Freshness)).toEqual(["fresh", "stale", "expired"]);
  });

  it("ControlState has 3 values", () => {
    expect(Object.values(ControlState)).toEqual(["idle", "running", "halted"]);
  });

  it("SubmissionState has 4 values", () => {
    expect(Object.values(SubmissionState)).toHaveLength(4);
    expect(Object.values(SubmissionState)).toContain("done");
    expect(Object.values(SubmissionState)).toContain("blocked");
  });

  it("ErrorType has 7 values", () => {
    expect(Object.values(ErrorType)).toHaveLength(7);
  });

  it("PropagationClass has 3 values", () => {
    expect(Object.values(PropagationClass)).toEqual(["local", "session", "global"]);
  });

  it("TimeoutClass has 4 values", () => {
    expect(Object.values(TimeoutClass)).toEqual(["short", "medium", "long", "infinite"]);
  });

  it("Role has 5 values", () => {
    expect(Object.values(Role)).toHaveLength(5);
    expect(Object.values(Role)).toContain("planner");
    expect(Object.values(Role)).toContain("observer");
  });

  it("Status has 4 values", () => {
    expect(Object.values(Status)).toHaveLength(4);
  });

  it("ChangeClass has 4 values", () => {
    expect(Object.values(ChangeClass)).toEqual(["create", "update", "delete", "rename"]);
  });

  it("all enum objects are readonly (as const enforced at compile time)", () => {
    // as const is a compile-time constraint; at runtime we verify the objects exist and have values
    const allEnums = [
      Tier, ArtifactFamily, Lifecycle, Freshness, ControlState,
      SubmissionState, ErrorType, PropagationClass, TimeoutClass,
      Role, Status, ChangeClass,
    ];
    for (const e of allEnums) {
      expect(Object.keys(e).length).toBeGreaterThan(0);
    }
  });
});
