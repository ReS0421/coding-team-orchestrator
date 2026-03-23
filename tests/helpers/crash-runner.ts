import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { RunnerReturn } from "../../src/runners/types.js";
import type { TestRunnerFn } from "./runner-options.js";

export type CrashMode = "timeout" | "crash" | "malformed_return" | "silent_failure";

export interface CrashRunnerOptions {
  mode: CrashMode;
  delayMs?: number;
  errorMessage?: string;
}

export function createCrashRunner(crashOpts: CrashRunnerOptions): TestRunnerFn {
  return async (
    _card: DispatchCard,
  ): Promise<RunnerReturn> => {
    switch (crashOpts.mode) {
      case "timeout": {
        await new Promise((resolve) =>
          setTimeout(resolve, crashOpts.delayMs ?? 100),
        );
        throw new Error(crashOpts.errorMessage ?? "Runner timed out");
      }
      case "crash": {
        throw new Error(crashOpts.errorMessage ?? "Runner crashed");
      }
      case "malformed_return": {
        return { invalid: true } as unknown as RunnerReturn;
      }
      case "silent_failure": {
        return {
          status: "done",
          touched_files: ["output.ts"],
          changeset: "feat: silent",
          delta_stub: "// delta",
          evidence: {
            build_pass: false,
            test_pass: false,
            test_summary: "silent failure - tests did not run",
          },
        } as RunnerReturn;
      }
      default:
        throw new Error(`Unknown crash mode: ${crashOpts.mode}`);
    }
  };
}
