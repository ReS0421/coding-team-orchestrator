import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { RunnerFn } from "../runners/types.js";
import { RollingSlotState } from "../domain/types.js";
import { safeValidateSpecialistSubmission } from "../schemas/specialist-submission.js";

export interface RollingSlot {
  specialist_id: string;
  state: RollingSlotState;
  result?: SpecialistSubmission;
}

export interface RollingDispatchConfig {
  active_span: number;
  specialist_cards: DispatchCard[];
  runner: RunnerFn;
  onSlotComplete?: (slot: RollingSlot) => void;
}

export interface RollingDispatchResult {
  slots: RollingSlot[];
  all_succeeded: boolean;
  failed_ids: string[];
}

/**
 * Promise-based rolling dispatch window.
 * Maintains up to active_span concurrent slots.
 * On slot completion, fills next from queue.
 * Failures = FAILED state; no retry.
 */
export async function runRollingDispatch(
  config: RollingDispatchConfig,
): Promise<RollingDispatchResult> {
  const { active_span, specialist_cards, runner, onSlotComplete } = config;

  if (specialist_cards.length === 0) {
    return { slots: [], all_succeeded: true, failed_ids: [] };
  }

  const slots: RollingSlot[] = [];
  const queue = [...specialist_cards];

  // Process each card as a slot
  // Rolling window: fill up to active_span, await earliest, fill next
  const pending: Promise<{ index: number }>[] = [];
  const slotMap: RollingSlot[] = [];

  // Pre-create all slots as IDLE
  for (const card of specialist_cards) {
    slots.push({ specialist_id: card.id, state: RollingSlotState.IDLE });
  }

  let nextIdx = 0;
  const inFlight = new Map<number, Promise<{ index: number }>>();

  // Launch initial active_span slots
  const initialBatch = Math.min(active_span, slots.length);
  for (let i = 0; i < initialBatch; i++) {
    const slotIndex = nextIdx++;
    slots[slotIndex].state = RollingSlotState.RUNNING;
    const card = specialist_cards[slotIndex];
    const p = runSlot(slotIndex, card, runner, slots, onSlotComplete);
    inFlight.set(slotIndex, p);
  }

  // Process remaining
  while (inFlight.size > 0) {
    // Wait for any slot to complete
    const completed = await Promise.race(inFlight.values());
    inFlight.delete(completed.index);

    // If there are more cards to process
    if (nextIdx < slots.length) {
      const slotIndex = nextIdx++;
      slots[slotIndex].state = RollingSlotState.RUNNING;
      const card = specialist_cards[slotIndex];
      const p = runSlot(slotIndex, card, runner, slots, onSlotComplete);
      inFlight.set(slotIndex, p);
    }
  }

  const failed_ids = slots
    .filter((s) => s.state === RollingSlotState.FAILED)
    .map((s) => s.specialist_id);

  return {
    slots,
    all_succeeded: failed_ids.length === 0,
    failed_ids,
  };
}

async function runSlot(
  index: number,
  card: DispatchCard,
  runner: RunnerFn,
  slots: RollingSlot[],
  onSlotComplete?: (slot: RollingSlot) => void,
): Promise<{ index: number }> {
  try {
    const raw = await runner(card);
    const validation = safeValidateSpecialistSubmission(raw);
    if (validation.success) {
      slots[index].state = RollingSlotState.COMPLETED;
      slots[index].result = validation.data;
    } else {
      slots[index].state = RollingSlotState.FAILED;
    }
  } catch {
    slots[index].state = RollingSlotState.FAILED;
  }
  if (onSlotComplete) {
    onSlotComplete(slots[index]);
  }
  return { index };
}
