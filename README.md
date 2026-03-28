# team-orchestrator

A TypeScript-based coding team orchestration engine + SKILL.md protocol that coordinates AI sub-agents to execute software development tasks through structured dispatch, two-stage review, and correction loops.

## Two Layers

### 1. SKILL.md Protocol (Primary — Sprint 7+)

The orchestration workflow runs entirely through SKILL.md prompt protocols, inspired by [Superpowers](https://github.com/obra/superpowers):

- **`team-orchestrator/SKILL.md`** — Orchestrator behavior protocol (sequential execution, two-stage review, correction rules)
- **`team-planner/SKILL.md`** — Plan authoring protocol (Superpowers writing-plans pattern)
- **Prompt templates** — implementer, spec-reviewer, quality-reviewer, final-reviewer

```
openclaw (depth 0)
  → plan authoring (team-planner)
  → sessions_spawn(orchestrator, depth 1)
    → implementer (depth 2, leaf) — per task
    → spec-reviewer (depth 2, leaf) — spec compliance
    → quality-reviewer (depth 2, leaf) — code quality
    → final-reviewer (depth 2, leaf) — integration review
```

**Flat depth 2. Sequential execution. No parallel implementation spawns.**

### 2. TypeScript Library (Reference Asset — Sprint 1~6)

The TS library (636 tests, ~5,500 LOC) serves as the formal specification for orchestration logic. It validates tier judgment, correction budgets, error resolution, shared protocols, and more through comprehensive tests.

## Package

- **npm name:** `team-orchestrator`
- **Version:** `0.7.0`
- **Entry point:** `src/index.ts` → `dist/index.js`
- **License:** MIT

## Architecture

### Tier Routing

| Tier | Description | Execution |
|---|---|---|
| Tier 1 | Single specialist, no shared files, write scope ≤ 5 | openclaw direct (no orchestrator) |
| Tier 2 | 2-3 specialists, shared files possible | Orchestrator → sequential impl + review |
| Tier 3 | 4+ specialists or architecture changes | Orchestrator → sequential impl + dual review |

### Two-Stage Review (per task)

1. **Spec Review** — Does the code match the specification? ("Do Not Trust the Report")
2. **Quality Review** — Is the code production-ready? (only after spec PASS)

### Correction Rules

- Max 2 correction rounds per task
- Spec FAIL → implementer fix → spec re-review
- Quality FAIL (CRITICAL) → implementer fix → quality re-review
- Exceeded → BLOCKED, dependent tasks skipped
- Report format violations → max 2 re-requests

## Tech Stack

- **Runtime:** Node.js v18+ (ESM)
- **Language:** TypeScript 5.4
- **Validation:** Zod
- **Testing:** Vitest

## Project Structure

```
src/
├── cli/          # CLI wrapper (judge, validate, dispatch commands)
│   ├── index.ts              # CLI entry point (main function)
│   ├── bin.ts                # #!/usr/bin/env node entry
│   └── commands/
│       ├── judge.ts          # Tier judgment
│       ├── validate.ts       # Zod schema validation
│       └── dispatch.ts       # Dispatch card generation
├── engine/       # Core orchestration logic
│   ├── orchestrator-tier1.ts # Tier 1 orchestrator (runTier1)
│   ├── orchestrator-tier2.ts # Tier 2 orchestrator (runTier2)
│   ├── orchestrator-tier3.ts # Tier 3 orchestrator (runTier3)
│   ├── tier-judge.ts         # Tier routing decision
│   ├── dispatch-rule.ts      # Dispatch rule evaluation
│   ├── correction.ts         # Correction / re-review decision
│   ├── error-resolution.ts   # Error strategy (retry/escalate/abort)
│   ├── dual-reviewer.ts      # Dual-reviewer merge logic
│   ├── rolling-dispatch.ts   # Rolling slot dispatch
│   ├── acting-lead.ts        # Acting lead lifecycle
│   ├── lead-recovery.ts      # Lead crash recovery
│   ├── heartbeat.ts          # Heartbeat / health monitor
│   ├── shared-owner-lifecycle.ts  # Shared owner state machine
│   ├── shared-protocol.ts    # Shared owner protocol helpers
│   └── patch-builder.ts      # Manifest patch construction
├── runners/      # Runner abstraction for sub-agent execution
│   ├── spawn-adapter.ts      # Real + fake spawn adapter
│   ├── output-parser.ts      # Raw output → typed return
│   ├── task-template.ts      # DispatchCard → task string
│   └── types.ts
├── schemas/      # Zod schemas for inter-agent contracts
├── store/        # Manifest, patch engine, checkpoint, artifacts
├── domain/       # Shared domain types
└── index.ts      # Public API surface
tests/            # 68 test files, 651 tests
```

## CLI

```bash
# Tier judgment
npx team-orchestrator judge '{"write_scope":["src/a.ts"],"specialist_count":1}'

# Schema validation
npx team-orchestrator validate '{"schema":"reviewer_return","data":{...}}'

# Dispatch card generation
npx team-orchestrator dispatch '{"task":"...","write_scope":[...],"brief":{...}}'
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
# 68 test files, 651 tests
```

### Type Check

```bash
npm run check
```

### Build

```bash
npm run build    # tsc → dist/
```

## Sprint History

| Sprint | Scope | Tests |
|---|---|---|
| 1 | Domain types, Zod schemas, tier-judge, dispatch-rule, error-resolution, fake runner | ~150 |
| 2 | runTier1, runTier2, correction loop, runParallel, artifact store | ~315 |
| 3 | Shared owner lifecycle, rolling dispatch, acting lead, runTier3, dual reviewer | ~450 |
| 4 | Heartbeat, lead recovery, shared protocol, event/error log schemas | ~530 |
| 5 | ExecutionContract, domain extensions, freshness, versioning, log-writer | ~595 |
| 6 | Real spawn adapter, output parser, task template, npm build, SKILL.md wrapper | **636** |
| 7 | **Architecture transition**: SKILL.md-Only Orchestration (Superpowers pattern), CLI wrapper, TS lib → reference asset | **651** |

## License

MIT
