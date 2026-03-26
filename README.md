# coding-team-orchestrator

A TypeScript-based 3-tier coding team orchestration engine that coordinates AI sub-agents (Planner, Specialist, Reviewer) to execute software development tasks through a structured dispatch and validation pipeline.

## Architecture

The system uses a 3-tier routing model:

| Tier | Description |
|---|---|
| Tier 1 | Direct specialist dispatch — simple, well-scoped tasks |
| Tier 2 | Planner → Specialist pipeline — tasks requiring decomposition |
| Tier 3 | Full orchestration with acting-lead — complex multi-step tasks |

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Language:** TypeScript 5.4
- **Validation:** Zod
- **Testing:** Vitest

## Project Structure

```
src/
├── engine/       # Core orchestration logic (orchestrator, tier-judge, dispatch-rule)
├── schemas/      # Zod schemas for inter-agent message contracts
├── store/        # Manifest, patch engine, checkpoint, artifact store
├── runners/      # Runner abstraction for sub-agent execution
└── domain/       # Shared domain types
tests/            # Unit tests
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
```

### Type Check

```bash
npm run build
```

## Key Concepts

- **DispatchCard** — task descriptor passed to each agent tier
- **Manifest** — YAML-based project state, versioned and patched per phase
- **Checkpoint** — phase-level snapshots for rollback and recovery
- **PatchSet** — structured diff applied to manifest after each agent turn

## License

MIT
