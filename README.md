# team-orchestrator

Multi-agent team orchestration framework with typed dispatch cards, specialist submissions, and review workflows.

## Setup

```bash
npm install
npm test
```

## Project Structure

```
src/
  domain/
    types.ts          # 12 as-const enums: Tier, Role, Status, etc.
    index.ts
  schemas/
    dispatch-card.ts       # DispatchCard schema + validate/safeValidate
    manifest-patch.ts      # ManifestPatch & ManifestPatchSet
    specialist-submission.ts
    error-log.ts
    planner-return.ts
    reviewer-return.ts
    lead-return.ts
    index.ts
tests/
  domain/
    types.test.ts
  schemas/
    dispatch-card.test.ts
    manifest-patch.test.ts
    specialist-submission.test.ts
    error-log.test.ts
    planner-return.test.ts
    reviewer-return.test.ts
    lead-return.test.ts
```

## Step 3: Fake Runner + Test Harness

```
tests/
  helpers/
    fake-runner.ts       # RunnerFn type + role-based default returns
    fake-runner.test.ts
    crash-runner.ts      # CrashMode: timeout, crash, malformed_return, silent_failure
    crash-runner.test.ts
    harness.ts           # Scenario/ScenarioResult types, runScenario, assertResult, makeDispatchCard
    harness.test.ts
  scenarios/
    tier1-happy.test.ts         # All roles succeed, schema validation
    tier1-planner-skip.test.ts  # Planner skip flow, specialist-only execution
    tier1-retry.test.ts         # Crash→log→retry flow with NDJSON error logging
```

## Tech Stack

- TypeScript (strict mode)
- Zod ^3.22 for runtime validation
- Vitest ^1.4 for testing
- Node.js 22
