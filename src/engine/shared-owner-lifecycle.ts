import { SharedOwnerState } from "../domain/types.js";

export interface SharedOwnerSession {
  owner_id: string;
  surface: string;
  state: SharedOwnerState;
  spawn_order: number;
}

/**
 * Transition shared owner state.
 * Valid transitions:
 *   active → advisory
 *   advisory → terminated
 *   active → terminated
 * All other transitions throw.
 */
export function transitionSharedOwner(
  session: SharedOwnerSession,
  to: SharedOwnerState,
): SharedOwnerSession {
  const from = session.state;

  const valid =
    (from === SharedOwnerState.ACTIVE && to === SharedOwnerState.ADVISORY) ||
    (from === SharedOwnerState.ADVISORY && to === SharedOwnerState.TERMINATED) ||
    (from === SharedOwnerState.ACTIVE && to === SharedOwnerState.TERMINATED);

  if (!valid) {
    throw new Error(
      `Invalid SharedOwnerState transition: ${from} → ${to}`,
    );
  }

  return { ...session, state: to };
}

/**
 * Check if amendment is allowed in advisory state.
 * Only allowed when state=advisory and no other amendment is active.
 * max concurrent amendments = 1 (micro-active).
 */
export function canAmendInAdvisory(
  session: SharedOwnerSession,
  activeAmendments: number,
): boolean {
  return session.state === SharedOwnerState.ADVISORY && activeAmendments === 0;
}

/**
 * Terminate all shared owner sessions (lead shutdown).
 * Skips already-terminated sessions.
 */
export function terminateAllOwners(
  sessions: SharedOwnerSession[],
): SharedOwnerSession[] {
  return sessions.map((s) => {
    if (s.state === SharedOwnerState.TERMINATED) return s;
    // Use direct transition — active or advisory → terminated
    return { ...s, state: SharedOwnerState.TERMINATED };
  });
}
