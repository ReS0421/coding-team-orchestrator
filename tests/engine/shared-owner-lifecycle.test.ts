import { describe, it, expect } from "vitest";
import {
  transitionSharedOwner,
  canAmendInAdvisory,
  terminateAllOwners,
  type SharedOwnerSession,
} from "../../src/engine/shared-owner-lifecycle.js";
import { SharedOwnerState } from "../../src/domain/types.js";

function makeSession(state: SharedOwnerState, id = "owner-1"): SharedOwnerSession {
  return { owner_id: id, surface: "src/api.ts", state, spawn_order: 1 };
}

describe("transitionSharedOwner", () => {
  it("active → advisory is valid", () => {
    const session = makeSession(SharedOwnerState.ACTIVE);
    const next = transitionSharedOwner(session, SharedOwnerState.ADVISORY);
    expect(next.state).toBe(SharedOwnerState.ADVISORY);
    expect(next.owner_id).toBe("owner-1"); // immutable copy
  });

  it("advisory → terminated is valid", () => {
    const session = makeSession(SharedOwnerState.ADVISORY);
    const next = transitionSharedOwner(session, SharedOwnerState.TERMINATED);
    expect(next.state).toBe(SharedOwnerState.TERMINATED);
  });

  it("active → terminated is valid", () => {
    const session = makeSession(SharedOwnerState.ACTIVE);
    const next = transitionSharedOwner(session, SharedOwnerState.TERMINATED);
    expect(next.state).toBe(SharedOwnerState.TERMINATED);
  });

  it("advisory → active throws", () => {
    const session = makeSession(SharedOwnerState.ADVISORY);
    expect(() => transitionSharedOwner(session, SharedOwnerState.ACTIVE)).toThrow();
  });

  it("terminated → active throws", () => {
    const session = makeSession(SharedOwnerState.TERMINATED);
    expect(() => transitionSharedOwner(session, SharedOwnerState.ACTIVE)).toThrow();
  });
});

describe("canAmendInAdvisory", () => {
  it("returns true when advisory and no active amendments", () => {
    const session = makeSession(SharedOwnerState.ADVISORY);
    expect(canAmendInAdvisory(session, 0)).toBe(true);
  });

  it("returns false when advisory but amendment already active", () => {
    const session = makeSession(SharedOwnerState.ADVISORY);
    expect(canAmendInAdvisory(session, 1)).toBe(false);
  });

  it("returns false when state is not advisory", () => {
    const session = makeSession(SharedOwnerState.ACTIVE);
    expect(canAmendInAdvisory(session, 0)).toBe(false);
  });
});

describe("terminateAllOwners", () => {
  it("terminates all active and advisory sessions", () => {
    const sessions: SharedOwnerSession[] = [
      makeSession(SharedOwnerState.ACTIVE, "o1"),
      makeSession(SharedOwnerState.ADVISORY, "o2"),
      makeSession(SharedOwnerState.TERMINATED, "o3"),
    ];
    const result = terminateAllOwners(sessions);
    expect(result.every((s) => s.state === SharedOwnerState.TERMINATED)).toBe(true);
  });

  it("returns immutable copies, original unchanged", () => {
    const sessions = [makeSession(SharedOwnerState.ACTIVE, "o1")];
    const result = terminateAllOwners(sessions);
    expect(sessions[0].state).toBe(SharedOwnerState.ACTIVE);
    expect(result[0].state).toBe(SharedOwnerState.TERMINATED);
  });
});
