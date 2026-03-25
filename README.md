# team-orchestrator

Multi-agent team orchestration framework for AI coding teams. A single host orchestrator owns the state machine and file artifacts, while subagents act as stateless workers that read dispatch cards and return schema-validated results.

## Quick Start

```bash
npm install
npm test        # 503 tests
npm run build   # tsc --noEmit (strict mode)
```

## Current Status

| Sprint | Focus | Tests | Status |
|--------|-------|-------|--------|
| 1 | Tier 1 Solo Specialist | 256 | ✅ Complete |
| 2 | Tier 2 Multi-Specialist | 331 | ✅ Complete |
| 3 | Tier 2 Shared Surface Protocol | 434 | ✅ Complete |
| 4 | Metadata Write Protocol | 503 | ✅ Complete |
| 5 | Tier 3 Execution Lead | — | 🔜 Next |
| 6 | Live Spawn Adapter | — | Planned |

**Total: 49 test files · 503 tests · tsc clean**

## Architecture

Three-plane separation:

```
┌─────────────────────────────────────────────────┐
│  Control Plane (engine/)                        │
│  State transitions, tier judgment, dispatch,    │
│  retry, correction loop, rollback, patch commit │
│  → All physical writes happen here only         │
├─────────────────────────────────────────────────┤
│  Worker Plane (runners/)                        │
│  Planner / Specialist / Reviewer / Lead spawn   │
│  → Read dispatch card, return schema-valid JSON │
├─────────────────────────────────────────────────┤
│  Artifact Plane (store/)                        │
│  Manifest, artifacts, checkpoints, versioning,  │
│  freshness propagation, NDJSON event logging    │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
src/
  domain/
    types.ts                  # Tier, Role, Status, Phase, BriefState,
                              #   CorrectionDisposition, SharedChangeType,
                              #   SharedCommitState, BlockedReason, etc.

  schemas/
    dispatch-card.ts          # DispatchCard (is_shared_owner, spawn_order,
                              #   priority_task, shared_surface)
    specialist-submission.ts  # SpecialistSubmission + BlockedOn
    error-log.ts              # ErrorLog with tier3_escalation
    event-log.ts              # EventLogEntry (Zod + .passthrough())
    manifest-patch.ts         # ManifestPatchSet for metadata writes
    brief.ts                  # Brief schema
    planner-return.ts
    reviewer-return.ts
    lead-return.ts

  store/
    types.ts                  # ManifestArtifact, ProjectManifest,
                              #   ManifestLite, ManifestLiteArtifact
    manifest.ts               # Manifest CRUD
    manifest-lite.ts          # Lightweight coordination artifact
    artifact-store.ts         # YAML frontmatter file I/O
    versioning.ts             # content_rev tracking
    freshness.ts              # Freshness propagation
    patch-engine.ts           # All-or-fail patch application
    checkpoint.ts             # Snapshot & restore (phase-aware)
    log-writer.ts             # NDJSON event/error logging

  engine/
    tier-judge.ts             # judgeTier: Tier 1/2/3 classification
    dispatch-rule.ts          # Planner detection, shared owner cards,
                              #   manifest-lite trigger
    orchestrator.ts           # runTier1, runTier2 (3-branch)
    error-resolution.ts       # resolveError: retry/escalate/abort
    correction.ts             # Correction loop with infinite guard
    shared-protocol.ts        # identifySharedOwner,
                              #   handleUnexpectedSharedChange
    acting-lead.ts            # selectActingLead (shared owner priority)
    patch-builder.ts          # buildPatchSetFromSubmission,
                              #   buildCombinedPatchSet

  runners/
    types.ts                  # RunnerFn, RunnerReturn, ParallelResult
    spawn-adapter.ts          # createSpawnAdapter, runParallel,
                              #   runSharedExecution

tests/
  scenarios/                  # End-to-end flow tests
    tier1-happy.test.ts
    tier1-planner-skip.test.ts
    tier1-retry.test.ts
    tier1-metadata.test.ts
    tier2-happy.test.ts
    tier2-correction.test.ts
    tier2-error-contained.test.ts
    tier2-metadata-happy.test.ts
    tier2-metadata-correction.test.ts
    tier2-metadata-rollback.test.ts
    tier2-shared-happy.test.ts
    tier2-shared-redispatch.test.ts
    tier2-shared-tier3-escalation.test.ts
    tier2-shared-acting-lead.test.ts
  engine/                     # Unit tests per engine module
    tier-judge.test.ts
    dispatch-rule.test.ts
    orchestrator.test.ts
    orchestrator-tier1.test.ts
    orchestrator-tier2.test.ts
    error-resolution.test.ts
    correction.test.ts
    shared-protocol.test.ts
    acting-lead.test.ts
    patch-builder.test.ts
    integration.test.ts
  schemas/                    # One test file per schema
  store/                      # One test file per store module + integration
  helpers/
    fake-runner.ts            # SharedBehavior support (owner/consumer)
    crash-runner.ts           # 4 failure modes
    harness.ts                # makeDispatchCard, makeBrief, runScenario
```

## Sprint History

### Sprint 1 — Tier 1 Solo Specialist
- 12 domain enums, 7 Zod schemas, 8 store modules
- `runTier1` FSM: INTAKE → JUDGE → DISPATCH → PLANNER → SPECIALIST → VALIDATE
- Retry logic, evidence validation, NDJSON logging
- 256 tests (includes post-sprint review fixes)

### Sprint 2 — Tier 2 Multi-Specialist
- Brief schema, parallel dispatch (2+ specialist cards), reviewer role
- `runTier2`: planner → parallel specialists → reviewer → correction loop
- `runParallel` with SettledResult pattern (allSettled-style)
- Error resolution engine (retry/escalate/abort)
- 331 tests (+75)

### Sprint 3 — Tier 2 Shared Surface Protocol
- **Shared execution**: owner-first → consumer dispatch → blocked detection → redispatch
- **3-branch `runTier2`**: Branch A (shared surface), Branch B (3+ specialists with acting lead), Branch C (legacy 2-specialist)
- `runSharedExecution` with consumer blocked re-check loop
- `handleUnexpectedSharedChange`: amendment flag, undiscovered shared, escalation threshold
- `selectActingLead`: shared owner priority, fallback to first specialist
- `ManifestLite`: lightweight coordination artifact for shared/3+ specialist flows
- Dispatch cards extended: `is_shared_owner`, `spawn_order`, `priority_task`, `shared_surface`
- Specialist submissions extended: `BlockedOn` (reason, surface, owner_id), `shared_amendment_flag`
- Tier 3 escalation signal: `tier3_escalation` in ErrorResolution + Tier2Result
- **Post-Sprint 3 code quality patch**: correction infinite loop guard, startsWith prefix collision fix, parameterized escalation thresholds
- 434 tests (+103)

### Sprint 4 — Metadata Write Protocol
- **Core goal**: Connect Sprint 1–3 store modules (patch-engine, checkpoint, versioning, freshness) into the orchestrator loop
- `buildPatchSetFromSubmission`: auto-generates manifest patches from specialist `touched_files`
- `buildCombinedPatchSet`: merges multiple specialist results into a single patch set (deferred commit pattern) to prevent `manifest_seq` conflicts in shared paths
- `applyPatchSetFull`: orchestrator-level patch commit with `incrementSeq` control to avoid double-increment
- Phase-aware checkpoints: `cp-{phase}-{seq}` format with `createCheckpointForPhase` / `findCheckpointByPhase`
- Correction rollback: restore from checkpoint → re-commit all submissions
- Deferred issues resolved: B-2 (increment type check), E-2 (loadManifest null guard), E-3 (deepEqual key ordering)
- 6 new scenario tests across 3 metadata test files
- 503 tests (+69)

## Key Design Decisions

- **Single physical committer**: Only the orchestrator (engine/) writes to disk. Subagents are pure functions.
- **Schema-first**: All inter-agent communication validated by Zod schemas at boundaries.
- **Simulation harness**: Full test coverage via fake runners — no live model calls needed.
- **Optimistic concurrency**: Shared path uses deferred commit to batch all specialist patches into one manifest update.
- **Phase-aware checkpoints**: Rollback targets specific orchestration phases, not arbitrary manifest versions.

## Tech Stack

- **TypeScript 5** (strict mode)
- **Zod** ^3.22 — runtime schema validation
- **Vitest** ^1.4 — test framework
- **js-yaml** ^4.1 — YAML frontmatter I/O
- **Node.js** 22

## Roadmap

### Sprint 5 — Tier 3 (Execution Lead)
- Execution lead with long-running sessions (`runTimeoutSeconds=0`)
- Rolling dispatch (active span 3)
- Merge-on-complete, dual reviewer (spec + quality)
- Lead heartbeat, stalled/crash detection & recovery

### Sprint 6 — Live Spawn Adapter
- Replace fake runners with real `sessions_spawn` calls
- End-to-end validation on actual projects
- Stabilization & bug fixes

## License

Private project — not yet published.
