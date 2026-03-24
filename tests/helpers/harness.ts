import type { DispatchCard } from "../../src/schemas/dispatch-card.js";
import type { RunnerReturn } from "../../src/runners/types.js";
import type { RunnerOptions, TestRunnerFn } from "./runner-options.js";

export interface ExpectedResult {
  should_succeed: boolean;
  error_message_contains?: string;
  return_assertions?: {
    status?: string;
    evidence_build_pass?: boolean;
    disposition?: string;
    final_merge_candidate?: boolean;
  };
}

export interface Scenario {
  name: string;
  tier: 1 | 2 | 3;
  dispatch_card: DispatchCard;
  runner: TestRunnerFn;
  runner_opts?: RunnerOptions;
  expected_result: ExpectedResult;
}

export interface ScenarioResult {
  scenario_name: string;
  success: boolean;
  return_value?: RunnerReturn;
  error?: Error;
  elapsed_ms: number;
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const start = performance.now();
  try {
    const result = await scenario.runner(
      scenario.dispatch_card,
      scenario.runner_opts,
    );
    const elapsed = performance.now() - start;
    return {
      scenario_name: scenario.name,
      success: true,
      return_value: result,
      elapsed_ms: elapsed,
    };
  } catch (err) {
    const elapsed = performance.now() - start;
    return {
      scenario_name: scenario.name,
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
      elapsed_ms: elapsed,
    };
  }
}

export function assertResult(
  result: ScenarioResult,
  expected: ExpectedResult,
): void {
  if (expected.should_succeed && !result.success) {
    throw new Error(
      `Expected scenario "${result.scenario_name}" to succeed but it failed: ${result.error?.message}`,
    );
  }
  if (!expected.should_succeed && result.success) {
    throw new Error(
      `Expected scenario "${result.scenario_name}" to fail but it succeeded`,
    );
  }

  if (!expected.should_succeed && expected.error_message_contains) {
    const msg = result.error?.message ?? "";
    if (!msg.includes(expected.error_message_contains)) {
      throw new Error(
        `Expected error to contain "${expected.error_message_contains}" but got "${msg}"`,
      );
    }
  }

  if (expected.return_assertions && result.return_value) {
    const val = result.return_value as Record<string, unknown>;
    const assertions = expected.return_assertions;

    if (assertions.status !== undefined && val.status !== assertions.status) {
      throw new Error(
        `Expected status "${assertions.status}" but got "${val.status}"`,
      );
    }
    if (assertions.evidence_build_pass !== undefined) {
      const evidence = val.evidence as Record<string, unknown> | undefined;
      if (evidence?.build_pass !== assertions.evidence_build_pass) {
        throw new Error(
          `Expected evidence.build_pass=${assertions.evidence_build_pass} but got ${evidence?.build_pass}`,
        );
      }
    }
    if (assertions.disposition !== undefined) {
      if (val.disposition_recommendation !== assertions.disposition) {
        throw new Error(
          `Expected disposition "${assertions.disposition}" but got "${val.disposition_recommendation}"`,
        );
      }
    }
    if (assertions.final_merge_candidate !== undefined) {
      if (val.final_merge_candidate !== assertions.final_merge_candidate) {
        throw new Error(
          `Expected final_merge_candidate=${assertions.final_merge_candidate} but got ${val.final_merge_candidate}`,
        );
      }
    }
  }
}

export function makeDispatchCard(
  overrides?: Partial<DispatchCard>,
): DispatchCard {
  return {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id: "test-task-001",
    tier: 1,
    task: "Implement test feature",
    input_refs: [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: ["src/output.ts"],
    completion_check: ["tests pass"],
    return_format: { schema: "SpecialistSubmission" },
    timeout_profile: { class: "standard", heartbeat_required: false },
    ...overrides,
  };
}

import type { Brief } from "../../src/schemas/brief.js";

export function makeBrief(overrides?: Partial<Brief>): Brief {
  return {
    brief_id: "test-brief",
    goal: "Test goal",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: [] },
      { id: "specialist-2", scope: ["src/api/"], owns: [] },
    ],
    shared: [],
    accept_checks: ["build passes"],
    escalate_if: [],
    ...overrides,
  };
}
