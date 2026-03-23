import { describe, it, expect } from "vitest";
import {
  getDirectDependents,
  computeFreshness,
  propagateFreshness,
} from "../../src/store/freshness.js";
import {
  ArtifactFamily,
  ChangeClass,
  Freshness,
  Lifecycle,
  ControlState,
} from "../../src/domain/types.js";
import { createEmptyManifest, addArtifact } from "../../src/store/manifest.js";

function makeManifest() {
  let m = createEmptyManifest("fresh-test");
  m = addArtifact(m, {
    id: "architecture",
    family: ArtifactFamily.REFERENCE,
    path: "architecture.md",
    content_rev: 1,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
  });
  m = addArtifact(m, {
    id: "spec",
    family: ArtifactFamily.REFERENCE,
    path: "spec.md",
    content_rev: 2,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
    depends_on: ["architecture"],
  });
  m = addArtifact(m, {
    id: "exec-contract",
    family: ArtifactFamily.CONTROL,
    path: "exec-contract.md",
    content_rev: 1,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
    control_state: ControlState.ACTIVE,
    depends_on: ["architecture", "spec"],
  });
  m = addArtifact(m, {
    id: "tasks",
    family: ArtifactFamily.REFERENCE,
    path: "tasks.md",
    content_rev: 1,
    lifecycle: Lifecycle.APPROVED,
    freshness: Freshness.FRESH,
    depends_on: ["spec"],
  });
  return m;
}

describe("getDirectDependents", () => {
  it("finds artifacts that depend on a given id", () => {
    const m = makeManifest();
    const deps = getDirectDependents(m, "architecture");
    expect(deps).toContain("spec");
    expect(deps).toContain("exec-contract");
    expect(deps).not.toContain("tasks");
  });

  it("returns empty array for no dependents", () => {
    const m = makeManifest();
    expect(getDirectDependents(m, "tasks")).toEqual([]);
  });
});

describe("computeFreshness", () => {
  it("structural + shared surface → stale_hard", () => {
    expect(computeFreshness(Freshness.FRESH, ChangeClass.STRUCTURAL, true)).toBe(
      Freshness.STALE_HARD,
    );
  });

  it("structural + normal → stale_soft", () => {
    expect(computeFreshness(Freshness.FRESH, ChangeClass.STRUCTURAL, false)).toBe(
      Freshness.STALE_SOFT,
    );
  });

  it("behavioral → stale_soft", () => {
    expect(computeFreshness(Freshness.FRESH, ChangeClass.BEHAVIORAL, false)).toBe(
      Freshness.STALE_SOFT,
    );
  });

  it("scope → stale_soft", () => {
    expect(computeFreshness(Freshness.FRESH, ChangeClass.SCOPE, false)).toBe(
      Freshness.STALE_SOFT,
    );
  });

  it("cosmetic → null (no propagation)", () => {
    expect(computeFreshness(Freshness.FRESH, ChangeClass.COSMETIC, false)).toBeNull();
  });
});

describe("propagateFreshness", () => {
  it("structural change propagates stale_soft to normal deps, stale_hard to control", () => {
    const m = makeManifest();
    const result = propagateFreshness(m, "architecture", ChangeClass.STRUCTURAL);
    const spec = result.artifacts.find((a) => a.id === "spec")!;
    const contract = result.artifacts.find((a) => a.id === "exec-contract")!;
    expect(spec.freshness).toBe(Freshness.STALE_SOFT);
    expect(contract.freshness).toBe(Freshness.STALE_HARD);
  });

  it("behavioral change propagates stale_soft to direct deps", () => {
    const m = makeManifest();
    const result = propagateFreshness(m, "spec", ChangeClass.BEHAVIORAL);
    const contract = result.artifacts.find((a) => a.id === "exec-contract")!;
    const tasks = result.artifacts.find((a) => a.id === "tasks")!;
    expect(contract.freshness).toBe(Freshness.STALE_SOFT);
    expect(tasks.freshness).toBe(Freshness.STALE_SOFT);
  });

  it("scope change propagates stale_soft only to control family", () => {
    const m = makeManifest();
    const result = propagateFreshness(m, "spec", ChangeClass.SCOPE);
    const contract = result.artifacts.find((a) => a.id === "exec-contract")!;
    const tasks = result.artifacts.find((a) => a.id === "tasks")!;
    expect(contract.freshness).toBe(Freshness.STALE_SOFT);
    expect(tasks.freshness).toBe(Freshness.FRESH); // reference, not control
  });

  it("cosmetic change does not propagate", () => {
    const m = makeManifest();
    const result = propagateFreshness(m, "architecture", ChangeClass.COSMETIC);
    expect(result).toEqual(m); // same reference
  });

  it("does not modify original manifest", () => {
    const m = makeManifest();
    propagateFreshness(m, "architecture", ChangeClass.STRUCTURAL);
    expect(m.artifacts.find((a) => a.id === "spec")!.freshness).toBe(Freshness.FRESH);
  });

  it("handles artifact with no dependents", () => {
    const m = makeManifest();
    const result = propagateFreshness(m, "tasks", ChangeClass.STRUCTURAL);
    expect(result).toEqual(m);
  });
});
