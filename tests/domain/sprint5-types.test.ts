import { describe, it, expect } from "vitest";
import {
  SharedOwnerState,
  RollingSlotState,
  LeadPhase,
} from "../../src/domain/types.js";

describe("SharedOwnerState", () => {
  it("has active, advisory, terminated", () => {
    expect(SharedOwnerState.ACTIVE).toBe("active");
    expect(SharedOwnerState.ADVISORY).toBe("advisory");
    expect(SharedOwnerState.TERMINATED).toBe("terminated");
  });
  it("has 3 values", () => {
    expect(Object.values(SharedOwnerState)).toHaveLength(3);
  });
});

describe("RollingSlotState", () => {
  it("has idle, running, completed, failed", () => {
    expect(RollingSlotState.IDLE).toBe("idle");
    expect(RollingSlotState.RUNNING).toBe("running");
    expect(RollingSlotState.COMPLETED).toBe("completed");
    expect(RollingSlotState.FAILED).toBe("failed");
  });
  it("has 4 values", () => {
    expect(Object.values(RollingSlotState)).toHaveLength(4);
  });
});

describe("LeadPhase", () => {
  it("has contract, shared_spawn, rolling, merge, shutdown", () => {
    expect(LeadPhase.CONTRACT).toBe("contract");
    expect(LeadPhase.SHARED_SPAWN).toBe("shared_spawn");
    expect(LeadPhase.ROLLING).toBe("rolling");
    expect(LeadPhase.MERGE).toBe("merge");
    expect(LeadPhase.SHUTDOWN).toBe("shutdown");
  });
  it("has 5 values", () => {
    expect(Object.values(LeadPhase)).toHaveLength(5);
  });
});

// Verify existing domain types are unchanged
import { Tier, ArtifactFamily, Lifecycle, Role, Status, Phase, CorrectionDisposition } from "../../src/domain/types.js";

describe("Existing types unchanged", () => {
  it("Tier still has 1, 2, 3", () => {
    expect(Tier.ONE).toBe(1); expect(Tier.TWO).toBe(2); expect(Tier.THREE).toBe(3);
  });
  it("Role still has 5 values", () => {
    expect(Object.values(Role)).toHaveLength(5);
  });
  it("Phase still has 7 values", () => {
    expect(Object.values(Phase)).toHaveLength(7);
  });
});
