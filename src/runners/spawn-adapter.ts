import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { BlockedOn } from "../schemas/specialist-submission.js";
import type { RunnerFn, RunnerReturn, ParallelResult, SettledResult } from "./types.js";
import { resolveError } from "../engine/error-resolution.js";
import { buildTaskTemplate, type TaskTemplateConfig } from "./task-template.js";
import { parseSpawnOutput } from "./output-parser.js";


export interface SpawnOptions {
  mode: "run";
  runtime: "subagent" | "acp";
  model?: string;
  runTimeoutSeconds?: number;
  cwd?: string;
}

export interface SpawnResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface RealSpawnConfig {
  /** sessions_spawn 호출 함수 (DI) */
  spawn: (task: string, options: SpawnOptions) => Promise<SpawnResult>;
  /** 프로젝트 경로 */
  projectPath: string;
  /** 설계 문서 경로 (읽기 전용) */
  designDocPaths?: string[];
  /** timeout profile → seconds 매핑 */
  timeoutMap?: Record<string, number>;
  /** 기본 retry 횟수 (default 1) */
  defaultRetries?: number;
}

export interface SpawnAdapterConfig {
  mode: "fake" | "real";
  fakeRunner?: RunnerFn;
  realConfig?: RealSpawnConfig;
}

/**
 * Create a runner function based on the adapter configuration.
 * In fake mode, delegates to the provided fakeRunner.
 * Real mode is a stub for Sprint 6.
 */
/** planner/reviewer → subagent, specialist/lead/shared_owner → acp */
export function resolveRuntime(card: DispatchCard): "subagent" | "acp" {
  if (card.role === "planner" || card.role === "reviewer") return "subagent";
  return "acp";
}

/** TimeoutProfile → seconds */
export function resolveTimeout(card: DispatchCard, map?: Record<string, number>): number {
  const defaults: Record<string, number> = {
    quick: 120, standard: 600, extended: 1800, unlimited: 0,
  };
  return { ...defaults, ...map }[card.timeout_profile.class] ?? 600;
}

export function createSpawnAdapter(config: SpawnAdapterConfig): RunnerFn {
  if (config.mode === "real") {
    if (!config.realConfig) {
      throw new Error("realConfig is required when mode is 'real'");
    }

    const { spawn, projectPath, designDocPaths, timeoutMap, defaultRetries } = config.realConfig;
    const templateConfig: TaskTemplateConfig = { projectPath, designDocPaths };

    return async (card: DispatchCard): Promise<RunnerReturn> => {
      const task = buildTaskTemplate(card, templateConfig);
      const runtime = resolveRuntime(card);
      const timeout = resolveTimeout(card, timeoutMap);

      let lastError: Error | undefined;
      const maxRetries = defaultRetries ?? 1;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await spawn(task, {
          mode: "run",
          runtime,
          runTimeoutSeconds: timeout,
          cwd: projectPath,
        });

        if (result.success && result.output) {
          try {
            return parseSpawnOutput(card, result.output);
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            if (attempt < maxRetries) continue;
            break;
          }
        }

        lastError = new Error(result.error ?? "Spawn failed");

        // Validation errors are not retryable
        if (result.error?.includes("validation")) break;
      }

      throw lastError ?? new Error("Spawn failed after retries");
    };
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

// ─── Sprint 3: Shared execution ─────────────────────────

export interface BlockedContext {
  card: DispatchCard;
  submission: SpecialistSubmission;
  blocked_on?: BlockedOn;
  shared_change_count: number;
}

export interface SharedExecutionOptions {
  ownerCards: DispatchCard[];
  consumerCards: DispatchCard[];
  runner: RunnerFn;
  onOwnerComplete?: (results: ParallelResult) => void;
  onConsumerBlocked?: (
    blocked: SettledResult,
    context: BlockedContext,
  ) => "redispatch_owner" | "escalate_tier3" | "retry";
  maxOwnerRedispatch?: number; // default 2
  maxOwnerRetries?: number; // default 1
}

export interface SharedExecutionResult {
  owner_results: ParallelResult;
  consumer_results: ParallelResult;
  all_succeeded: boolean;
  failed_ids: string[];
  shared_changes: number;
  tier3_escalation: boolean;
  redispatch_count: number;
}

const EMPTY_PARALLEL: ParallelResult = {
  settled: [],
  all_succeeded: true,
  failed_ids: [],
};

/**
 * Run shared execution: owner first → consumer second.
 * Handles owner failures, consumer BLOCKED, re-dispatch, and Tier 3 escalation.
 */
export async function runSharedExecution(
  options: SharedExecutionOptions,
): Promise<SharedExecutionResult> {
  const maxRedispatch = options.maxOwnerRedispatch ?? 2;
  const maxRetries = options.maxOwnerRetries ?? 1;
  let redispatchCount = 0;
  let sharedChanges = 0;

  // ── Step 1: Run owner cards ──
  let ownerResults = await runParallel(options.ownerCards, options.runner);

  // Owner failure → retry
  if (!ownerResults.all_succeeded) {
    const resolution = resolveError({
      error_type: "crash",
      retry_count: 0,
      max_retries: maxRetries,
      correction_count: 0,
      max_corrections: 2,
      is_final_attempt: false,
    });

    if (resolution === "retry") {
      // Retry only failed owners
      const failedCards = options.ownerCards.filter((c) =>
        ownerResults.failed_ids.includes(c.id),
      );
      const retryResults = await runParallel(failedCards, options.runner);

      // Merge retry results
      const retryMap = new Map(
        retryResults.settled.map((s) => [s.id, s]),
      );
      ownerResults = {
        settled: ownerResults.settled.map((s) =>
          retryMap.has(s.id) ? retryMap.get(s.id)! : s,
        ),
        all_succeeded: ownerResults.settled.every((s) => {
          const final = retryMap.has(s.id) ? retryMap.get(s.id)! : s;
          return final.status === "fulfilled";
        }),
        failed_ids: ownerResults.settled
          .filter((s) => {
            const final = retryMap.has(s.id) ? retryMap.get(s.id)! : s;
            return final.status === "rejected";
          })
          .map((s) => s.id),
      };
    }

    // Still failed after retry → consumer skip, total failure
    if (!ownerResults.all_succeeded) {
      return {
        owner_results: ownerResults,
        consumer_results: EMPTY_PARALLEL,
        all_succeeded: false,
        failed_ids: ownerResults.failed_ids,
        shared_changes: sharedChanges,
        tier3_escalation: false,
        redispatch_count: redispatchCount,
      };
    }
  }

  // Owner complete callback
  if (options.onOwnerComplete) {
    options.onOwnerComplete(ownerResults);
  }

  // ── Step 2: Run consumer cards (with blocked-retry loop) ──
  let consumerResults = await runParallel(
    options.consumerCards,
    options.runner,
  );

  // Re-check loop: after redispatch/retry, consumers may still be blocked
  let consumerCheckNeeded = true;
  while (consumerCheckNeeded) {
    consumerCheckNeeded = false;

    for (const settled of consumerResults.settled) {
      if (settled.status !== "fulfilled" || !settled.value) continue;

      const submission = settled.value as SpecialistSubmission;
      if (submission.status !== "blocked") continue;

      // Consumer is BLOCKED
      const blockedOn = (submission as SpecialistSubmission & { blocked_on?: BlockedOn }).blocked_on;
      const context: BlockedContext = {
        card: options.consumerCards.find((c) => c.id === settled.id)!,
        submission,
        blocked_on: blockedOn,
        shared_change_count: sharedChanges,
      };

      if (!options.onConsumerBlocked) continue;

      const action = options.onConsumerBlocked(settled, context);

      if (action === "escalate_tier3") {
        return {
          owner_results: ownerResults,
          consumer_results: consumerResults,
          all_succeeded: false,
          failed_ids: [settled.id],
          shared_changes: sharedChanges,
          tier3_escalation: true,
          redispatch_count: redispatchCount,
        };
      }

      if (action === "redispatch_owner") {
        redispatchCount++;
        sharedChanges++;

        if (redispatchCount > maxRedispatch) {
          return {
            owner_results: ownerResults,
            consumer_results: consumerResults,
            all_succeeded: false,
            failed_ids: [settled.id],
            shared_changes: sharedChanges,
            tier3_escalation: true,
            redispatch_count: redispatchCount,
          };
        }

        // Re-run owner with incremented dispatch_rev
        const redispatchCards = options.ownerCards.map((c) => ({
          ...c,
          dispatch_rev: c.dispatch_rev + redispatchCount,
        }));
        ownerResults = await runParallel(redispatchCards, options.runner);

        // Re-run consumers and re-check
        consumerResults = await runParallel(
          options.consumerCards,
          options.runner,
        );
        consumerCheckNeeded = true;
        break; // restart the for loop with new results
      }

      if (action === "retry") {
        const retryCard = options.consumerCards.find(
          (c) => c.id === settled.id,
        );
        if (retryCard) {
          const retryResult = await runParallel([retryCard], options.runner);
          consumerResults = {
            ...consumerResults,
            settled: consumerResults.settled.map((s) =>
              s.id === settled.id ? retryResult.settled[0] : s,
            ),
          };
          consumerCheckNeeded = true;
          break; // restart check with updated results
        }
      }
    }
  }

  // Final assessment
  const allSettled = [
    ...ownerResults.settled,
    ...consumerResults.settled,
  ];
  const allFailed = allSettled
    .filter((s) => s.status === "rejected")
    .map((s) => s.id);

  return {
    owner_results: ownerResults,
    consumer_results: consumerResults,
    all_succeeded: allFailed.length === 0,
    failed_ids: allFailed,
    shared_changes: sharedChanges,
    tier3_escalation: false,
    redispatch_count: redispatchCount,
  };
}
