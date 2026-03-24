import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { RunnerFn, ParallelResult, SettledResult } from "./types.js";

export interface SpawnAdapterConfig {
  mode: "fake" | "real";
  fakeRunner?: RunnerFn;
}

/**
 * Create a runner function based on the adapter configuration.
 * In fake mode, delegates to the provided fakeRunner.
 * Real mode is a stub for Sprint 6.
 */
export function createSpawnAdapter(config: SpawnAdapterConfig): RunnerFn {
  if (config.mode === "real") {
    throw new Error("Real spawn not implemented yet — Sprint 6");
  }

  if (!config.fakeRunner) {
    throw new Error("fakeRunner is required when mode is 'fake'");
  }

  return config.fakeRunner;
}

/**
 * Run multiple dispatch cards in parallel.
 * Uses Promise.allSettled for fault tolerance — one crash doesn't kill others.
 */
export async function runParallel(
  cards: DispatchCard[],
  runner: RunnerFn,
): Promise<ParallelResult> {
  const promises = cards.map(async (card): Promise<SettledResult> => {
    try {
      const value = await runner(card);
      return { id: card.id, status: "fulfilled", value };
    } catch (err) {
      return {
        id: card.id,
        status: "rejected",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  });

  const settled = await Promise.all(promises);
  const failed_ids = settled
    .filter((s) => s.status === "rejected")
    .map((s) => s.id);

  return {
    settled,
    all_succeeded: failed_ids.length === 0,
    failed_ids,
  };
}
