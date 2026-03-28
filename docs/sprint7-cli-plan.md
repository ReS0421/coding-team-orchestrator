# CLI Wrapper Implementation Plan

**Goal:** team-orchestrator 패키지에 CLI 진입점을 추가하여 `npx team-orchestrator judge` 등의 명령으로 핵심 기능을 호출할 수 있게 한다.
**Tier:** 2
**Test Command:** npm test
**Architecture:** src/cli/ 디렉토리에 CLI 모듈 추가. 기존 engine/ 함수를 호출하는 thin wrapper. commander.js 없이 process.argv 직접 파싱 (의존성 최소화).
**Tech Stack:** TypeScript, Node.js, vitest

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | src/cli/index.ts | CLI 진입점 (main 함수) |
| Create | src/cli/commands/judge.ts | `judge` 명령 — Brief JSON → tier 판정 결과 |
| Create | src/cli/commands/validate.ts | `validate` 명령 — JSON 입력을 Zod schema로 검증 |
| Create | src/cli/commands/dispatch.ts | `dispatch` 명령 — Brief → dispatch cards 생성 |
| Modify | package.json | bin 필드 + build 스크립트 추가 |
| Create | tests/cli/judge.test.ts | judge 명령 테스트 |
| Create | tests/cli/validate.test.ts | validate 명령 테스트 |
| Create | tests/cli/dispatch.test.ts | dispatch 명령 테스트 |
| Create | src/cli/bin.ts | 실행 가능한 CLI entry point (#!/usr/bin/env node) |
| Create | tests/cli/integration.test.ts | main() 통합 테스트 |
| Modify | src/index.ts | CLI public export 추가 |

---

### Task 1: CLI 진입점 + judge 명령

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/judge.ts`
- Create: `tests/cli/judge.test.ts`

**Dependencies:** 없음

- [ ] **Step 1: Write the failing test for judge command**

```typescript
// tests/cli/judge.test.ts
import { describe, it, expect } from "vitest";
import { runJudge } from "../../src/cli/commands/judge.js";

describe("CLI judge command", () => {
  it("should return tier 1 for simple input", () => {
    const input = {
      write_scope: ["src/index.ts"],
      specialist_count: 1,
    };
    const result = runJudge(input);
    expect(result.tier).toBe(1);
    expect(result).toHaveProperty("tier");
  });

  it("should return tier 2 for multi-specialist input", () => {
    const input = {
      write_scope: ["src/a.ts", "src/b.ts"],
      specialist_count: 2,
      shared_surfaces: [
        { path: "src/types.ts", rule: "append-only", owner: "spec-a" },
      ],
    };
    const result = runJudge(input);
    expect(result.tier).toBe(2);
  });

  it("should return tier 3 for 4+ specialists", () => {
    const input = {
      write_scope: ["src/a.ts"],
      specialist_count: 4,
    };
    const result = runJudge(input);
    expect(result.tier).toBe(3);
    expect(result.reason).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/judge.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement judge command**

```typescript
// src/cli/commands/judge.ts
import { judgeTier, type TierJudgeInput, type TierJudgeResult } from "../../engine/tier-judge.js";

export function runJudge(input: TierJudgeInput): TierJudgeResult {
  return judgeTier(input);
}
```

- [ ] **Step 4: Implement CLI entry point**

```typescript
// src/cli/index.ts
import { runJudge } from "./commands/judge.js";

interface CliResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function main(args: string[]): CliResult {
  const command = args[0];

  if (!command) {
    return {
      success: false,
      error: "Usage: team-orchestrator <command> [options]\nCommands: judge, validate, dispatch",
    };
  }

  switch (command) {
    case "judge": {
      const jsonInput = args[1];
      if (!jsonInput) {
        return { success: false, error: "judge requires JSON input as second argument" };
      }
      try {
        const input = JSON.parse(jsonInput);
        const result = runJudge(input);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    default:
      return { success: false, error: `Unknown command: ${command}` };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/judge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: add CLI judge command with tier judgment"
```

---

### Task 2: validate 명령

**Files:**
- Create: `src/cli/commands/validate.ts`
- Create: `tests/cli/validate.test.ts`
- Modify: `src/cli/index.ts` (validate case 추가)

**Dependencies:** Task 1

- [ ] **Step 1: Write the failing test for validate command**

```typescript
// tests/cli/validate.test.ts
import { describe, it, expect } from "vitest";
import { runValidate } from "../../src/cli/commands/validate.js";

describe("CLI validate command", () => {
  it("should validate a correct specialist submission", () => {
    const input = {
      schema: "specialist_submission",
      data: {
        status: "done",
        touched_files: ["src/index.ts"],
        changeset: "diff content",
        delta_stub: "stub content",
        evidence: {
          build_pass: true,
          test_pass: true,
          test_summary: "3/3 pass",
        },
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should reject an invalid specialist submission", () => {
    const input = {
      schema: "specialist_submission",
      data: {
        status: "invalid_status",
        touched_files: [],
        changeset: "",
        delta_stub: "",
        evidence: { build_pass: true, test_pass: true, test_summary: "" },
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("should validate a correct reviewer return", () => {
    const input = {
      schema: "reviewer_return",
      data: {
        review_report: "All good",
        disposition_recommendation: "PASS",
        issues: [],
      },
    };
    const result = runValidate(input);
    expect(result.valid).toBe(true);
  });

  it("should return error for unknown schema", () => {
    const input = { schema: "unknown", data: {} };
    const result = runValidate(input);
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("Unknown schema");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/validate.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement validate command**

```typescript
// src/cli/commands/validate.ts
import { safeValidateSpecialistSubmission } from "../../schemas/specialist-submission.js";
import { safeValidateReviewerReturn } from "../../schemas/reviewer-return.js";
import { safeValidateBrief } from "../../schemas/brief.js";
import { safeValidateDispatchCard } from "../../schemas/dispatch-card.js";

export interface ValidateInput {
  schema: string;
  data: unknown;
}

export interface ValidateResult {
  valid: boolean;
  errors?: string[];
}

const validators: Record<string, (data: unknown) => { success: boolean; error?: { issues: { message: string }[] } }> = {
  specialist_submission: safeValidateSpecialistSubmission,
  reviewer_return: safeValidateReviewerReturn,
  brief: safeValidateBrief,
  dispatch_card: safeValidateDispatchCard,
};

export function runValidate(input: ValidateInput): ValidateResult {
  const validator = validators[input.schema];
  if (!validator) {
    return { valid: false, errors: [`Unknown schema: ${input.schema}`] };
  }

  const result = validator(input.data);
  if (result.success) {
    return { valid: true };
  }

  const errors = result.error?.issues.map((i) => i.message) ?? ["Validation failed"];
  return { valid: false, errors };
}
```

- [ ] **Step 4: Add validate to CLI entry point**

`src/cli/index.ts`의 switch문에 추가:

```typescript
case "validate": {
  const jsonInput = args[1];
  if (!jsonInput) {
    return { success: false, error: "validate requires JSON input as second argument" };
  }
  try {
    const input = JSON.parse(jsonInput);
    const result = runValidate(input);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

그리고 상단 import에 추가:
```typescript
import { runValidate } from "./commands/validate.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/validate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: add CLI validate command with schema validation"
```

---

### Task 3: dispatch 명령

**Files:**
- Create: `src/cli/commands/dispatch.ts`
- Create: `tests/cli/dispatch.test.ts`
- Modify: `src/cli/index.ts` (dispatch case 추가)

**Dependencies:** Task 1

- [ ] **Step 1: Write the failing test for dispatch command**

```typescript
// tests/cli/dispatch.test.ts
import { describe, it, expect } from "vitest";
import { runDispatch } from "../../src/cli/commands/dispatch.js";

describe("CLI dispatch command", () => {
  it("should generate dispatch cards for a tier 2 brief", () => {
    const input = {
      task: "Add feature X",
      write_scope: ["src/a.ts", "src/b.ts"],
      brief: {
        brief_id: "test-brief",
        specialists: [
          { id: "spec-a", scope: ["src/a.ts"], owns: [] },
          { id: "spec-b", scope: ["src/b.ts"], owns: [] },
        ],
        shared: [],
        accept_checks: ["tests pass"],
      },
    };
    const result = runDispatch(input);
    expect(result.tier).toBe(2);
    expect(result.specialist_cards.length).toBe(2);
    expect(result.reviewer_card).toBeDefined();
    expect(result.reviewer_card.role).toBe("reviewer");
  });

  it("should detect shared surfaces and assign owner", () => {
    const input = {
      task: "Modify shared types",
      write_scope: ["src/types.ts", "src/a.ts", "src/b.ts"],
      brief: {
        brief_id: "shared-brief",
        specialists: [
          { id: "spec-a", scope: ["src/a.ts"], owns: ["src/types.ts"] },
          { id: "spec-b", scope: ["src/b.ts"], owns: [] },
        ],
        shared: ["src/types.ts"],
        accept_checks: ["tests pass"],
      },
    };
    const result = runDispatch(input);
    expect(result.has_shared).toBe(true);
    const ownerCard = result.specialist_cards.find((c: any) => c.is_shared_owner);
    expect(ownerCard).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/dispatch.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement dispatch command**

```typescript
// src/cli/commands/dispatch.ts
import { createEmptyManifest } from "../../store/manifest.js";
import { evaluateTier2DispatchRule, type TaskRequest } from "../../engine/dispatch-rule.js";
import { judgeTier } from "../../engine/tier-judge.js";
import type { Brief } from "../../schemas/brief.js";

export interface DispatchInput extends TaskRequest {
  brief: Brief;
}

export interface DispatchResult {
  tier: number;
  specialist_cards: unknown[];
  reviewer_card: unknown;
  has_shared: boolean;
  needs_planner: boolean;
}

export function runDispatch(input: DispatchInput): DispatchResult {
  const { tier } = judgeTier({
    write_scope: input.write_scope,
    shared_surfaces: input.shared_surfaces,
    specialist_count: input.brief.specialists.length,
  });

  const manifest = createEmptyManifest("cli");
  const result = evaluateTier2DispatchRule(manifest, input, input.brief);

  return {
    tier,
    specialist_cards: result.specialist_cards,
    reviewer_card: result.reviewer_card,
    has_shared: result.has_shared,
    needs_planner: result.needs_planner,
  };
}
```

- [ ] **Step 4: Add dispatch to CLI entry point**

`src/cli/index.ts`의 switch문에 추가:

```typescript
case "dispatch": {
  const jsonInput = args[1];
  if (!jsonInput) {
    return { success: false, error: "dispatch requires JSON input as second argument" };
  }
  try {
    const input = JSON.parse(jsonInput);
    const result = runDispatch(input);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}
```

그리고 상단 import에 추가:
```typescript
import { runDispatch } from "./commands/dispatch.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/dispatch.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: add CLI dispatch command with card generation"
```

---

### Task 4: package.json bin 필드 + CLI entry script + 통합 테스트

**Files:**
- Modify: `package.json` (bin 필드 추가)
- Create: `src/cli/bin.ts` (실행 가능한 entry point)
- Create: `tests/cli/integration.test.ts` (main() 통합 테스트)
- Modify: `src/index.ts` (CLI public export 추가)

**Dependencies:** Task 1, 2, 3

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/cli/integration.test.ts
import { describe, it, expect } from "vitest";
import { main } from "../../src/cli/index.js";

describe("CLI main integration", () => {
  it("should show usage when no command given", () => {
    const result = main([]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Usage");
  });

  it("should return error for unknown command", () => {
    const result = main(["unknown"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown command");
  });

  it("should run judge with valid JSON", () => {
    const input = JSON.stringify({ write_scope: ["src/a.ts"], specialist_count: 1 });
    const result = main(["judge", input]);
    expect(result.success).toBe(true);
    expect((result.data as any).tier).toBe(1);
  });

  it("should run validate with valid JSON", () => {
    const input = JSON.stringify({
      schema: "reviewer_return",
      data: {
        review_report: "Good",
        disposition_recommendation: "PASS",
        issues: [],
      },
    });
    const result = main(["validate", input]);
    expect(result.success).toBe(true);
    expect((result.data as any).valid).toBe(true);
  });

  it("should run dispatch with valid JSON", () => {
    const input = JSON.stringify({
      task: "Test",
      write_scope: ["src/a.ts"],
      brief: {
        brief_id: "b1",
        specialists: [{ id: "s1", scope: ["src/a.ts"], owns: [] }],
        shared: [],
        accept_checks: ["pass"],
      },
    });
    const result = main(["dispatch", input]);
    expect(result.success).toBe(true);
  });

  it("should handle invalid JSON gracefully", () => {
    const result = main(["judge", "not-json"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/integration.test.ts`
Expected: PASS or FAIL depending on Task 1-3 completion

- [ ] **Step 3: Create bin entry point**

```typescript
// src/cli/bin.ts
#!/usr/bin/env node
import { main } from "./index.js";

const result = main(process.argv.slice(2));

if (result.success) {
  console.log(JSON.stringify(result.data, null, 2));
  process.exit(0);
} else {
  console.error(result.error);
  process.exit(1);
}
```

- [ ] **Step 4: Update package.json**

`package.json`에 추가:

```json
{
  "bin": {
    "team-orchestrator": "./dist/cli/bin.js"
  }
}
```

- [ ] **Step 5: Add CLI export to src/index.ts**

`src/index.ts` 하단에 추가:

```typescript
// CLI
export { main as cliMain } from "./cli/index.js";
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: 636 + 15 new = ~651 tests PASS

- [ ] **Step 7: Build and verify**

```bash
npm run build
ls dist/cli/
```
Expected: `bin.js`, `index.js`, `commands/judge.js`, `commands/validate.js`, `commands/dispatch.js` 존재

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: CLI bin entry point + package.json bin + integration tests"
```
