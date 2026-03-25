# team-orchestrator

Multi-agent team orchestration framework with typed dispatch cards, specialist submissions, and review workflows.

## Setup

```bash
npm install
npm test
```

## Current Status

| Sprint | Focus | Tests | Status |
|--------|-------|-------|--------|
| 1 | Tier 1 (Solo Specialist) | 200 | ✅ Complete |
| 2 | Tier 2 (Multi-Specialist) | 331 | ✅ Complete |
| 3 | Tier 2 Shared Surface | 434 | ✅ Complete |
| 4 | Correction Loop + Review | — | 🔜 Next |
| 5 | Tier 3 (Execution Lead) | — | Planned |

## Project Structure

```
src/
  domain/
    types.ts              # Domain enums: Tier, Role, Status, Phase, BriefState,
                          #   CorrectionDisposition, SharedChangeType,
                          #   SharedCommitState, BlockedReason, etc.
  schemas/
    dispatch-card.ts      # DispatchCard — shared fields: is_shared_owner,
                          #   spawn_order, priority_task, shared_surface
    specialist-submission.ts  # SpecialistSubmission + BlockedOn (shared_pending)
    error-log.ts          # ErrorLog with tier3_escalation resolution
    event-log.ts          # EventLogEntry (Zod + .passthrough())
    planner-return.ts
    reviewer-return.ts
    lead-return.ts
    manifest-patch.ts
    brief.ts
  store/
    types.ts              # ManifestArtifact, ProjectManifest,
                          #   ManifestLite, ManifestLiteArtifact
    manifest.ts           # Manifest CRUD
    manifest-lite.ts      # ManifestLite create/save/load
    artifact-store.ts     # YAML frontmatter file I/O
    versioning.ts         # content_rev tracking
    freshness.ts          # Freshness propagation
    patch-engine.ts       # All-or-fail patch application
    checkpoint.ts         # Snapshot & restore
    log-writer.ts         # NDJSON event/error logging (EventLogEntry typed)
  engine/
    tier-judge.ts         # judgeTier: Tier 1/2/3 classification
    dispatch-rule.ts      # evaluateTier2DispatchRule: planner detection,
                          #   shared owner cards, manifest-lite trigger
    orchestrator.ts       # runTier1, runTier2 (3-branch shared path)
    error-resolution.ts   # resolveError: retry/escalate/abort/tier3_escalation
    correction.ts         # Correction loop engine
    shared-protocol.ts    # identifySharedOwner, handleUnexpectedSharedChange
    acting-lead.ts        # selectActingLead (shared owner priority)
  runners/
    types.ts              # RunnerFn, RunnerReturn, ParallelResult
    spawn-adapter.ts      # createSpawnAdapter, runParallel, runSharedExecution

tests/
  scenarios/
    tier1-happy.test.ts
    tier1-planner-skip.test.ts
    tier1-retry.test.ts
    tier2-happy.test.ts
    tier2-correction.test.ts
    tier2-failure.test.ts
    tier2-shared-happy.test.ts
    tier2-shared-redispatch.test.ts
    tier2-shared-tier3-escalation.test.ts
    tier2-shared-acting-lead.test.ts
  engine/
    tier-judge.test.ts
    dispatch-rule.test.ts
    orchestrator.test.ts
    error-resolution.test.ts
    shared-protocol.test.ts
    acting-lead.test.ts
    integration.test.ts
  schemas/   # One test file per schema
  store/     # One test file per module + integration
  helpers/
    fake-runner.ts        # SharedBehavior support (owner/consumer modes)
    crash-runner.ts       # 4 failure modes
    harness.ts            # makeDispatchCard, makeBrief, runScenario
```

## Sprint History

### Sprint 1 — Tier 1 (Solo Specialist)
- 12 domain enums, 7 Zod schemas, 8 store modules
- `runTier1` FSM: INTAKE → JUDGE → DISPATCH → PLANNER → SPECIALIST → VALIDATE
- Retry logic, evidence validation, NDJSON logging
- 200 tests

### Sprint 2 — Tier 2 (Multi-Specialist)
- Brief schema, parallel dispatch (2+ specialist cards), reviewer role
- `runTier2`: planner → parallel specialists → reviewer → correction loop
- `runParallel` with SettledResult pattern (allSettled-style)
- Error resolution engine (retry/escalate/abort)
- 331 tests (+131)

### Sprint 3 — Tier 2 Shared Surface Protocol
- **Shared execution**: owner-first → consumer dispatch → blocked detection → redispatch
- **3-branch runTier2**: Branch A (shared), Branch B (3+ specialists acting lead), Branch C (legacy)
- `runSharedExecution` with consumer blocked re-check loop (while+break pattern)
- `handleUnexpectedSharedChange`: amendment flag, undiscovered shared, escalation threshold
- `selectActingLead`: shared owner priority, fallback to first specialist
- `ManifestLite`: lightweight coordination artifact for shared/3+ specialist flows
- Dispatch cards extended: `is_shared_owner`, `spawn_order`, `priority_task`, `shared_surface`
- Specialist submissions extended: `BlockedOn` (reason, surface, owner_id), `shared_amendment_flag`
- Tier 3 escalation signal: `tier3_escalation` in ErrorResolution + Tier2Result
- 17 scenario tests across 4 test files
- 434 tests (+103, includes code quality patch)

### Post-Sprint 3: Code Quality Patch
- **Critical fix**: correction loop infinite guard (empty re-dispatch → escalate)
- **High fixes**: startsWith prefix collision, dispatch_rev hardcoded, tier-judge throw→return value
- **Medium fixes**: Branch B/C dedup, prefix accumulation, dispatch/merge_owner JSDoc
- **Low fixes**: unused param JSDoc, escalation thresholds parameterized
- 434 tests (+1 correction guard test)

## Tech Stack

- TypeScript 5 (strict mode)
- Zod ^3.22 for runtime validation
- Vitest ^1.4 for testing
- Node.js 22
