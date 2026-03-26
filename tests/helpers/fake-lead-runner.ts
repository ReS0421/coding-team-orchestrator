import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { LeadReturn } from "../../src/schemas/lead-return.js";
import type { SpecialistSubmission } from "../../src/schemas/specialist-submission.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { ProjectManifest } from "../../src/store/types.js";
import type { RunnerFn } from "../../src/runners/types.js";
import type { RunnerReturn } from "../../src/runners/types.js";
import { SharedOwnerState } from "../../src/domain/types.js";

export interface SharedOwnerTransition {
  owner_id: string;
  from: SharedOwnerState;
  to: SharedOwnerState;
  timestamp: number;
}

export interface FakeLeadRunnerOptions {
  innerRunner: RunnerFn;
  shouldCrash?: boolean;
  crashAfterSpecialists?: number;
  specialist_cards: DispatchCard[];
  brief: Brief;
  manifest: ProjectManifest;
  onSharedOwnerTransition?: (t: SharedOwnerTransition) => void;
}

export interface FakeLeadRunnerResult {
  runner: RunnerFn;
  getSharedOwnerTransitions: () => SharedOwnerTransition[];
}

/**
 * Create a fake lead runner that simulates lead execution:
 * - Runs specialist cards via innerRunner
 * - Manages shared owner lifecycle: ACTIVE → ADVISORY → TERMINATED
 * - Records shared owner transitions
 * - Returns a proper LeadReturn
 */
export function createFakeLeadRunner(options: FakeLeadRunnerOptions): FakeLeadRunnerResult {
  const {
    innerRunner,
    shouldCrash = false,
    crashAfterSpecialists,
    specialist_cards,
    brief,
    manifest,
    onSharedOwnerTransition,
  } = options;

  const transitions: SharedOwnerTransition[] = [];

  function recordTransition(
    ownerId: string,
    from: SharedOwnerState,
    to: SharedOwnerState,
  ): void {
    const t: SharedOwnerTransition = {
      owner_id: ownerId,
      from,
      to,
      timestamp: Date.now(),
    };
    transitions.push(t);
    if (onSharedOwnerTransition) {
      onSharedOwnerTransition(t);
    }
  }

  const runner: RunnerFn = async (card: DispatchCard): Promise<RunnerReturn> => {
    if (shouldCrash) {
      throw new Error("Lead crashed intentionally");
    }

    // Collect specialist results
    const specialistResults: SpecialistSubmission[] = [];
    const sharedOwnerIds = brief.specialists
      .filter((s) => specialist_cards.some((c) => c.id === s.id && c.is_shared_owner))
      .map((s) => s.id);

    // Track shared owner states
    const ownerStates: Record<string, SharedOwnerState> = {};
    for (const ownerId of sharedOwnerIds) {
      ownerStates[ownerId] = SharedOwnerState.ACTIVE;
      recordTransition(ownerId, SharedOwnerState.ACTIVE, SharedOwnerState.ACTIVE);
    }

    // Run specialists via innerRunner
    for (let i = 0; i < specialist_cards.length; i++) {
      if (crashAfterSpecialists !== undefined && i >= crashAfterSpecialists) {
        throw new Error(`Lead crashed after ${crashAfterSpecialists} specialists`);
      }

      const specCard = specialist_cards[i];
      try {
        const result = await innerRunner(specCard);
        specialistResults.push(result as SpecialistSubmission);
      } catch {
        specialistResults.push({
          status: "done_with_concerns",
          touched_files: [],
          changeset: `failed-${specCard.id}`,
          delta_stub: "// no delta",
          evidence: { build_pass: false, test_pass: false, test_summary: "failed" },
        });
      }
    }

    // Transition shared owners: ACTIVE → ADVISORY (rolling done)
    for (const ownerId of sharedOwnerIds) {
      const prev = ownerStates[ownerId];
      ownerStates[ownerId] = SharedOwnerState.ADVISORY;
      recordTransition(ownerId, prev, SharedOwnerState.ADVISORY);
    }

    // Transition shared owners: ADVISORY → TERMINATED (final)
    for (const ownerId of sharedOwnerIds) {
      const prev = ownerStates[ownerId];
      ownerStates[ownerId] = SharedOwnerState.TERMINATED;
      recordTransition(ownerId, prev, SharedOwnerState.TERMINATED);
    }

    // Build shared_owner_states for LeadReturn
    const sharedOwnerStates: Record<string, "active" | "advisory" | "terminated"> = {};
    for (const [id, state] of Object.entries(ownerStates)) {
      sharedOwnerStates[id] = state as "active" | "advisory" | "terminated";
    }

    const leadReturn: LeadReturn = {
      final_merge_candidate: true,
      execution_summary: `Lead execution complete for ${brief.brief_id}`,
      specialist_results: specialistResults,
      manifest_updates: {
        base_manifest_seq: manifest.manifest_seq,
        apply_mode: "all_or_fail",
        patches: [{
          artifact_id: "lead-execution",
          op: "set",
          field: "lifecycle",
          new_value: "approved",
          reason: "lead execution complete",
        }],
      },
      shared_owner_states: Object.keys(sharedOwnerStates).length > 0 ? sharedOwnerStates : undefined,
    };

    return leadReturn;
  };

  return {
    runner,
    getSharedOwnerTransitions: () => [...transitions],
  };
}
