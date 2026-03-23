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

## Tech Stack

- TypeScript (strict mode)
- Zod ^3.22 for runtime validation
- Vitest ^1.4 for testing
- Node.js 22
