import type { RunnerFn } from "./types.js";

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
