# team-orchestrator

A TypeScript-based 3-tier coding team orchestration engine that coordinates AI sub-agents (Planner, Specialist, Reviewer, Execution Lead) to execute software development tasks through a structured dispatch and validation pipeline.

## Package

- **npm name:** `team-orchestrator`
- **Version:** `0.6.0`
- **Entry point:** `src/index.ts` → `dist/index.js`
- **License:** MIT

## Architecture

The system uses a 3-tier routing model:

| Tier | Description |
|---|---|
| Tier 1 | Direct specialist dispatch — simple, well-scoped tasks |
| Tier 2 | Planner → Specialist pipeline — tasks requiring decomposition |
| Tier 3 | Full orchestration with acting-lead — complex multi-step tasks |

## Tech Stack

- **Runtime:** Node.js v18+ (ESM)
- **Language:** TypeScript 5.4
- **Validation:** Zod
- **Testing:** Vitest

## Project Structure

```
src/
├── engine/       # Core orchestration logic
│   ├── orchestrator.ts          # Shared orchestrator utilities
│   ├── orchestrator-tier1.ts    # Tier 1 orchestrator (runTier1)
│   ├── orchestrator-tier2.ts    # Tier 2 orchestrator (runTier2)
│   ├── orchestrator-tier3.ts    # Tier 3 orchestrator (runTier3)
│   ├── tier-judge.ts            # Tier routing decision logic
│   ├── dispatch-rule.ts         # Dispatch rule evaluation
│   ├── correction.ts            # Correction / re-review decision
│   ├── error-resolution.ts      # Error strategy (retry/escalate/abort)
│   ├── dual-reviewer.ts         # Dual-reviewer merge logic
│   ├── rolling-dispatch.ts      # Rolling slot dispatch
│   ├── acting-lead.ts           # Acting lead lifecycle
│   ├── lead-recovery.ts         # Lead crash recovery
│   ├── heartbeat.ts             # Heartbeat / health monitor
│   ├── shared-owner-lifecycle.ts# Shared owner state machine
│   ├── shared-protocol.ts       # Shared owner protocol helpers
│   ├── patch-builder.ts         # Manifest patch construction
│   └── index.ts
├── runners/      # Runner abstraction for sub-agent execution
│   ├── spawn-adapter.ts         # Real + fake spawn adapter (createSpawnAdapter)
│   ├── output-parser.ts         # Raw subagent output → typed RunnerReturn
│   ├── task-template.ts         # DispatchCard → sessions_spawn task string
│   ├── types.ts                 # RunnerFn, ParallelResult, SettledResult
│   └── index.ts
├── schemas/      # Zod schemas for inter-agent message contracts
├── store/        # Manifest, patch engine, checkpoint, artifact store
├── domain/       # Shared domain types
└── index.ts      # Public API surface (re-exports)
tests/            # 64 test files, 636 tests
```

## Getting Started

### Prerequisites

- Node.js v18+
- npm

### Installation

```bash
git clone https://github.com/ReS0421/coding-team-orchestrator.git
cd coding-team-orchestrator
npm install
```

### Run Tests

```bash
npm test
# 64 test files, 636 tests
```

### Type Check

```bash
npm run check    # tsc --noEmit (includes tests)
```

### Build (npm publish)

```bash
npm run build    # tsc → dist/
```

The `prepublishOnly` hook runs `build` automatically on `npm publish`.

## Key Concepts

- **DispatchCard** — task descriptor passed to each agent tier
- **Manifest** — YAML-based project state, versioned and patched per phase
- **Checkpoint** — phase-level snapshots for rollback and recovery
- **PatchSet** — structured diff applied to manifest after each agent turn
- **SpawnAdapter** — bridges the orchestration engine to real `sessions_spawn` calls or a fake runner for testing
- **OutputParser** — extracts and validates JSON from raw subagent/ACP output (supports plain JSON, fenced blocks, and balanced-brace extraction)
- **TaskTemplate** — converts a DispatchCard into a role-specific task string for `sessions_spawn`

## Runners

The `runners/` layer manages the boundary between the orchestration engine and real AI sub-agents.

### SpawnAdapter

`createSpawnAdapter(config)` returns a `RunnerFn` operating in one of two modes:

| Mode | Description |
|---|---|
| `fake` | Delegates to a provided `fakeRunner` — used in all unit/integration tests |
| `real` | Calls `sessions_spawn` with a generated task string; supports retry, timeout profiles, and DI for the spawn function |

```typescript
import { createSpawnAdapter } from "team-orchestrator";

const runner = createSpawnAdapter({
  mode: "real",
  realConfig: {
    spawn: sessionsSpawnFn,   // injected sessions_spawn wrapper
    projectPath: "/path/to/project",
    designDocPaths: ["/path/to/tasks.md"],
    timeoutMap: { quick: 120, standard: 600, extended: 1800 },
    defaultRetries: 1,
  },
});
```

Runtime is auto-resolved per role:
- `planner` / `reviewer` → `runtime: "subagent"`
- `specialist` / `shared_owner` / `execution_lead` → `runtime: "acp"`

### OutputParser

`parseSpawnOutput(card, rawOutput)` extracts a valid JSON block from raw agent output and validates it against the role's Zod schema. Supports three extraction strategies: direct JSON, fenced `` ```json `` blocks, and balanced-brace search.

### TaskTemplate

`buildTaskTemplate(card, config)` generates a role-specific task string (persona + instructions + return format) for injection into `sessions_spawn`.

## Sprint History

| Sprint | Scope | Tests |
|---|---|---|
| Sprint 1 | Domain types, Zod schemas, tier-judge, dispatch-rule, error-resolution, fake runner harness | ~150 |
| Sprint 2 | runTier1, runTier2, correction loop, runParallel, artifact store | ~315 |
| Sprint 3 | Shared owner lifecycle, rolling dispatch, acting lead, runTier3, dual reviewer, patch builder | ~450 |
| Sprint 4 | Heartbeat, lead recovery, shared protocol, shared owner state machine, event/error log schemas | ~530 |
| Sprint 5 | ExecutionContract schema, domain type extensions, store freshness, versioning, log-writer, API surface | ~595 |
| Sprint 6 | Real spawn adapter (DI-based), output parser, task template, npm build config (`dist/`, `exports`), SKILL.md | **636** |

## License

MIT
