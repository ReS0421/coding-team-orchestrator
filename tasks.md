# Sprint 2 — Tasks 2.10~2.14

## Context

team-orchestrator 프로젝트. TypeScript + Zod + vitest.
Sprint 2의 2.0~2.9까지 완료 (315 tests PASS, tsc clean).

현재 구현된 모듈들:
- `src/domain/types.ts` — Tier, BriefState, Phase, CorrectionDisposition 등
- `src/schemas/brief.ts` — BriefSchema (Zod)
- `src/schemas/reviewer-return.ts` — CrossCheckEntry 포함
- `src/schemas/specialist-submission.ts` — 4-status protocol
- `src/engine/tier-judge.ts` — Tier 1/2 판정 + Tier 3 가드
- `src/engine/dispatch-rule.ts` — evaluateDispatchRule (Tier 1) + evaluateTier2DispatchRule (Tier 2)
- `src/engine/correction.ts` — decideCorrection (fix_and_rereview / escalate / abort)
- `src/engine/error-resolution.ts` — resolveError (retry / escalate / abort)
- `src/engine/orchestrator.ts` — runTier1 (Tier 1 full cycle)
- `src/runners/types.ts` — RunnerFn, ParallelResult, SettledResult
- `src/runners/spawn-adapter.ts` — createSpawnAdapter + runParallel
- `src/store/artifact-store.ts` — saveBrief/loadBrief thin wrapper 포함
- `tests/helpers/fake-runner.ts` — role별 기본 응답 생성
- `tests/helpers/harness.ts` — makeDispatchCard, runScenario, assertResult
- `tests/helpers/runner-options.ts` — RunnerOptions, TestRunnerFn
- `tests/helpers/crash-runner.ts` — crash/timeout/malformed 시뮬레이션

## Constraints

1. **회귀 게이트**: 매 태스크 완료 후 `npx vitest run && npx tsc --noEmit` 실행. 기존 315 테스트 전부 통과해야 함.
2. **import 규칙**: `.js` 확장자 사용 (ESM). 예: `from "./types.js"`
3. **새 파일 추가 시**: 해당 index.ts에 `export * from "./새파일.js"` 추가
4. **테스트 위치**: `tests/` (root level, src 밖)

## Task 2.10: runTier2 오케스트레이터

파일: `src/engine/orchestrator.ts`에 추가

```typescript
export interface Tier2Config extends OrchestratorConfig {
  maxCorrections?: number;  // default 2
}

export interface Tier2Request extends TaskRequest {
  brief: Brief;
}

export interface Tier2Result {
  success: boolean;
  tier: 2;
  phase: Phase;
  specialist_results: ParallelResult;
  review_result?: ReviewerReturn;
  correction_count: number;
  planner_result?: PlannerReturn;
  error?: string;
}

export async function runTier2(
  config: Tier2Config,
  request: Tier2Request,
): Promise<Tier2Result>
```

### Flow 구현:

**Phase 0 (intake):**
- manifest 로드/생성 (runTier1과 동일 패턴)
- tier 판정 → Tier 2 확인 (아니면 에러)

**Phase 1 (planning):**
- evaluateTier2DispatchRule(manifest, request, brief) 호출
- needs_planner → planner spawn → 결과 검증
- planner 실패 시 에러 반환

**Phase 2 (execution):**
- specialist_cards를 runParallel로 병렬 실행
- 각 결과를 safeValidateSpecialistSubmission으로 검증
- 실패한 specialist 식별

**Phase 3 (review):**
- reviewer_card로 runner 호출
- safeValidateReviewerReturn으로 검증
- disposition 확인: PASS → 성공, FAIL → correction

**Correction loop:**
- FAIL 시 decideCorrection 호출
- fix_and_rereview → re_dispatch_cards로 다시 Phase 2 (해당 specialist만)
- 재실행 후 reviewer_re_dispatch로 Phase 3 재진입
- correction_count 증가
- max (2회) 초과 → escalation
- PASS → done

**Error handling:**
- specialist crash/malformed → resolveError로 판정
- contained propagation: 한 specialist 실패가 다른 specialist에 영향 안 줌
- 재시도: runParallel에서 실패한 specialist만 개별 재실행 (runParallel 다시 호출하되 실패 card만)

### 테스트:
`tests/engine/orchestrator.test.ts`에 추가:
- runTier2 기본 동작 (2명 specialist → reviewer PASS)
- runTier2 Tier 불일치 에러

## Task 2.11: fake-runner Tier 2 확장

### tests/helpers/runner-options.ts 수정:
```typescript
// 추가할 필드:
export interface RunnerOptions {
  // ... 기존 ...
  crossCheckOverride?: CrossCheckEntry[];
  correctionBehavior?: "fail_then_pass" | "always_fail" | "always_pass";
}
```

### tests/helpers/fake-runner.ts 수정:

**reviewer 응답에 cross_check 지원:**
- opts.crossCheckOverride가 있으면 사용
- 없으면 기본 5항목 전부 pass

**correction 시나리오 지원:**
- fakeRunner를 stateful로 확장 — `createStatefulRunner()` 팩토리 추가
- 내부에 호출 카운터 유지
- correctionBehavior === "fail_then_pass": reviewer 첫 호출 FAIL (blocking issue 포함), 두 번째 호출 PASS
- correctionBehavior === "always_fail": reviewer 항상 FAIL
- correctionBehavior === "always_pass": reviewer 항상 PASS (기본)

```typescript
export function createStatefulRunner(opts?: RunnerOptions): TestRunnerFn {
  let reviewerCallCount = 0;
  return async (card, runOpts?) => {
    const mergedOpts = { ...opts, ...runOpts };
    if (card.role === "reviewer") {
      reviewerCallCount++;
      const behavior = mergedOpts?.correctionBehavior ?? "always_pass";
      if (behavior === "fail_then_pass" && reviewerCallCount === 1) {
        // Return FAIL with blocking issue
        ...
      }
      // etc.
    }
    return fakeRunner(card, mergedOpts);
  };
}
```

### tests/helpers/harness.ts 수정:
```typescript
export function makeBrief(overrides?: Partial<Brief>): Brief {
  return {
    brief_id: "test-brief",
    goal: "Test goal",
    out_of_scope: [],
    specialists: [
      { id: "specialist-1", scope: ["src/auth/"], owns: [] },
      { id: "specialist-2", scope: ["src/api/"], owns: [] },
    ],
    shared: [],
    accept_checks: ["build passes"],
    escalate_if: [],
    ...overrides,
  };
}
```

## Task 2.12: tier2-happy 시나리오

파일: `tests/scenarios/tier2-happy.test.ts`

```
시나리오: shared-free, specialist 2명
  - brief: specialist-1 (src/auth/), specialist-2 (src/api/), shared: []
  - manifest에 tasks_md approved+fresh (planner skip)
  - Phase 2: 2명 병렬 → 둘 다 DONE
  - Phase 3: reviewer PASS, cross_check 전항목 pass
  - 결과: success=true, phase=done, correction_count=0
```

테스트 항목:
1. result.success === true
2. result.phase === "done"
3. result.tier === 2
4. result.correction_count === 0
5. result.specialist_results.all_succeeded === true
6. result.specialist_results.settled.length === 2
7. result.review_result 존재, disposition_recommendation === "PASS"

## Task 2.13: tier2-correction 시나리오

파일: `tests/scenarios/tier2-correction.test.ts`

**시나리오 1: reviewer FAIL → correction → re-review PASS**
```
  - correctionBehavior: "fail_then_pass"
  - Phase 3 첫 리뷰: FAIL (specialist-1에 blocking issue)
  - Correction: fix_and_rereview
  - specialist-1만 re-dispatch
  - Phase 3 재리뷰: PASS
  - 결과: success=true, correction_count=1
```

**시나리오 2: correction max 초과**
```
  - correctionBehavior: "always_fail"
  - reviewer 연속 FAIL → correction 2회 → escalation
  - 결과: success=false, phase=failed, error에 "escalat" 포함
```

## Task 2.14: tier2-error-contained 시나리오

파일: `tests/scenarios/tier2-error-contained.test.ts`

**시나리오 1: specialist crash → contained → retry → 완료**
```
  - specialist-1용 runner가 첫 호출에서 throw (crash)
  - specialist-2는 정상 DONE
  - propagation: contained (specialist-2 영향 없음)
  - specialist-1 retry → DONE
  - Phase 3: reviewer PASS
  - 결과: success=true
```

**시나리오 2: specialist crash + retry 소진**
```
  - specialist-1이 항상 crash
  - retry 소진 → resolveError → escalate
  - 결과: success=false
```

이 시나리오에서는 runTier2 내부에서 실패 specialist 재실행 로직이 필요.
접근법: runParallel 후 failed_ids 확인 → 실패 card만 개별 runner 호출 (retry 1회) → 성공 시 settled 결과 교체.

## Implementation Order

2.11 → 2.10 → 2.12 → 2.13 → 2.14

2.11(fake-runner)이 먼저여야 2.10 테스트와 2.12~14 시나리오에서 사용 가능.

## Final Checklist

- [ ] 모든 기존 315 테스트 통과
- [ ] tsc --noEmit clean
- [ ] 새 테스트 파일 4개 (orchestrator 확장 + 시나리오 3개)
- [ ] 총 테스트 수 360+ 목표

