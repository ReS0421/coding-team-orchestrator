# team-orchestrator

A coding team orchestration system for [OpenClaw](https://github.com/openclaw/openclaw), combining SKILL.md prompt protocols with a TypeScript reference library. Coordinates AI sub-agents through structured dispatch, two-stage review, and correction loops.

## How It Works

The orchestration runs as **OpenClaw skills** — SKILL.md files that define behavior protocols for openclaw and its subagents.

```
openclaw (depth 0)
  → plan authoring (skills/team-planner/)
  → sessions_spawn(orchestrator, depth 1)
    → implementer (depth 2, leaf) — per task
    → spec-reviewer (depth 2, leaf) — spec compliance
    → quality-reviewer (depth 2, leaf) — code quality
    → final-reviewer (depth 2, leaf) — integration review
```

**Flat depth 2. Sequential execution. No parallel implementation spawns.**

### OpenClaw Skills

| Skill | Location | Used By |
|---|---|---|
| `team-planner` | `~/.openclaw/workspace/skills/team-planner/` | openclaw (directly) — plan authoring |
| `team-orchestrator` | `~/.openclaw/workspace/skills/team-orchestrator/` | orchestrator subagent — plan execution |

The orchestrator skill includes 4 prompt templates:
- `implementer-prompt.md` — Task implementation (TDD, self-review, structured report)
- `spec-reviewer-prompt.md` — Spec compliance verification ("Do Not Trust the Report")
- `quality-reviewer-prompt.md` — Code quality review (severity-based)
- `final-reviewer-prompt.md` — Integration review (cross-task consistency)

Design inspired by [Superpowers](https://github.com/obra/superpowers) (writing-plans + subagent-driven-development patterns).

### OpenClaw Configuration

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,
        maxChildrenPerAgent: 5
      }
    }
  }
}
```

## Tier Routing

| Tier | Condition | Execution |
|---|---|---|
| Tier 1 | 1 specialist, no shared files, write scope ≤ 5 | openclaw direct (no orchestrator) |
| Tier 2 | 2-3 specialists | Orchestrator → sequential impl + review |
| Tier 3 | 4+ specialists or architecture changes | Orchestrator → sequential impl + dual review |

Tier is determined by openclaw during plan authoring (team-planner skill). The orchestrator follows the Plan header's Tier without re-judgment.

## Two-Stage Review (per task)

1. **Spec Review** — Does the code match the specification? (code inspection, not report trust)
2. **Quality Review** — Is the code production-ready? (only proceeds after spec PASS)

### Structured Report Formats

All subagents return structured reports (`## REPORT`, `## SPEC_REVIEW`, `## QUALITY_REVIEW`, `## FINAL_REVIEW`). Missing headers → orchestrator re-requests (max 2, then BLOCKED).

### Correction Rules

- Max 2 correction rounds per task
- Spec FAIL → implementer fix → spec re-review
- Quality FAIL (CRITICAL) → implementer fix → quality re-review
- Exceeded → BLOCKED; dependent tasks skipped, independent tasks continue
- VERDICT: PASS or FAIL only (no CONDITIONAL)

## TypeScript Reference Library

The TS library (651 tests, ~5,500 LOC) serves as the **formal specification** for orchestration logic — tier judgment, correction budgets, error resolution, shared protocols, dispatch rules. It validates the design through comprehensive tests, and its functions are exposed via CLI for optional programmatic use.

### CLI

```bash
# Tier judgment
npx team-orchestrator judge '{"write_scope":["src/a.ts"],"specialist_count":1}'

# Schema validation
npx team-orchestrator validate '{"schema":"reviewer_return","data":{...}}'

# Dispatch card generation
npx team-orchestrator dispatch '{"task":"...","write_scope":[...],"brief":{...}}'
```

### Project Structure

```
src/
├── cli/          # CLI wrapper (judge, validate, dispatch)
├── engine/       # Core orchestration logic (tier-judge, correction, dispatch-rule, etc.)
├── runners/      # Spawn adapter (real + fake), output parser, task template
├── schemas/      # Zod schemas for inter-agent contracts
├── store/        # Manifest, patch engine, checkpoint, artifacts
├── domain/       # Shared domain types
└── index.ts      # Public API surface
tests/            # 68 test files, 651 tests
```

## Getting Started

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and configured
- Node.js v18+ (for TS library / CLI)

### Install Skills

The skills are located in the OpenClaw workspace:

```
~/.openclaw/workspace/skills/
├── team-planner/
│   └── SKILL.md          # Plan authoring protocol
└── team-orchestrator/
    ├── SKILL.md           # Orchestrator behavior protocol
    ├── implementer-prompt.md
    ├── spec-reviewer-prompt.md
    ├── quality-reviewer-prompt.md
    └── final-reviewer-prompt.md
```

### Install TS Library (optional)

```bash
git clone https://github.com/ReS0421/coding-team-orchestrator.git
cd coding-team-orchestrator
npm install
npm test    # 68 test files, 651 tests
```

## Sprint History

| Sprint | Scope | Tests |
|---|---|---|
| 1 | Domain types, Zod schemas, tier-judge, dispatch-rule, error-resolution | ~150 |
| 2 | runTier1, runTier2, correction loop, runParallel, artifact store | ~315 |
| 3 | Shared owner lifecycle, rolling dispatch, acting lead, runTier3, dual reviewer | ~450 |
| 4 | Heartbeat, lead recovery, shared protocol, event/error log schemas | ~530 |
| 5 | ExecutionContract, domain extensions, freshness, versioning, log-writer | ~595 |
| 6 | Real spawn adapter, output parser, task template, npm build, SKILL.md wrapper | **636** |
| 7 | **Architecture transition**: SKILL.md-Only (Superpowers pattern), OpenClaw skills, CLI wrapper, TS lib → reference asset | **651** |

## License

MIT
