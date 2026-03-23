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
  store/
    types.ts               # ManifestArtifact, ProjectManifest, etc.
    artifact-store.ts      # YAML frontmatter file I/O
    manifest.ts            # Manifest CRUD (create, load, save, find, add)
    versioning.ts          # content_rev tracking
    freshness.ts           # Freshness propagation
    patch-engine.ts        # All-or-fail patch application
    checkpoint.ts          # Snapshot & restore
    log-writer.ts          # NDJSON event/error logging
    index.ts
  engine/
    tier-judge.ts          # judgeTier: Tier 1/2 classification
    dispatch-rule.ts       # evaluateDispatchRule: planner detection + card generation
    orchestrator.ts        # runTier1: FSM (intake→judge→dispatch→planner→specialist→validate)
    index.ts
  runners/
    spawn-adapter.ts       # createSpawnAdapter: fake/real mode switching
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
  store/
    artifact-store.test.ts
    manifest.test.ts
    patch-engine.test.ts
    versioning.test.ts
    freshness.test.ts
    checkpoint.test.ts
    log-writer.test.ts
    types.test.ts
    integration.test.ts
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
  engine/
    tier-judge.test.ts          # Tier 1/2 classification edge cases
    dispatch-rule.test.ts       # Planner detection + dispatch card validation
    orchestrator.test.ts        # FSM unit tests (happy, retry, evidence, tier reject)
    integration.test.ts         # Full Tier 1 E2E: spawn→orchestrate→verify logs
  runners/
    spawn-adapter.test.ts       # Fake/real mode adapter tests
```

## Sprint 1 Steps

### Step 1–2: Domain + Schemas + Store
- 12 domain enums, 7 Zod schemas, 8 store modules
- Manifest CRUD, versioning, freshness propagation, checkpointing, NDJSON logging

### Step 3: Fake Runner + Test Harness
- `RunnerFn` type with role-based defaults (planner, specialist, reviewer, lead)
- `CrashRunner` with 4 failure modes (timeout, crash, malformed_return, silent_failure)
- Scenario harness with `runScenario`, `assertResult`, `makeDispatchCard`
- 3 scenario tests: tier1-happy, tier1-planner-skip, tier1-retry

### Step 4: Tier 1 E2E Orchestrator
- `judgeTier`: Tier 1 (no shared surfaces, ≤1 specialist, ≤5 write scope) vs Tier 2
- `evaluateDispatchRule`: planner detection (tasks_md lifecycle/freshness) + dispatch card generation
- `createSpawnAdapter`: fake/real mode runner factory
- `runTier1` FSM: INTAKE → TIER_JUDGE → DISPATCH → PLANNER → SPECIALIST → VALIDATE
  - Retry logic with configurable maxRetries (default 2)
  - Evidence validation (build_pass + test_pass)
  - NDJSON event/error logging
- Full E2E integration test with tmpdir isolation

## Tech Stack

- TypeScript (strict mode)
- Zod ^3.22 for runtime validation
- Vitest ^1.4 for testing
- Node.js 22
