---
name: team-planner
description: 코딩팀 Plan 작성 — Superpowers writing-plans 패턴. openclaw이 직접 사용. orchestrator용 Plan을 생성한다.
---

# Team Planner

코드 변경 요청을 구현 가능한 Plan으로 변환하는 프로토콜.
openclaw이 직접 사용하며, 산출물은 orchestrator subagent에게 전달된다.

## 언제 사용하는가

- 코드 변경 요청이 Tier 2~3 규모일 때 (specialist 2명 이상)
- **사용하지 않을 때:** Tier 1 (openclaw이 직접 실행), 단순 질문, 설계 논의

## Plan의 목표

> **"enthusiastic junior engineer with poor taste, no judgement, no project context"도
> 이 Plan을 읽고 올바른 코드를 작성할 수 있어야 한다.**

Plan이 충분히 상세하면 implementer의 모델 성능에 덜 의존한다.
Plan의 품질 = 최종 코드의 품질.

---

## Plan Header (필수)

모든 Plan은 이 header로 시작한다:

```markdown
# {Feature Name} Implementation Plan

**Goal:** {한 문장 — 이 Plan이 뭘 만드는가}
**Tier:** {2 | 3}
**Test Command:** {npm test | pytest | go test ./... | etc.}
**Architecture:** {2~3 문장 — 접근 방식}
**Tech Stack:** {핵심 기술/라이브러리}

---
```

## Tier 판정 기준

Plan 작성 시 openclaw이 판정한다:

| Tier | 조건 | 실행 방식 |
|---|---|---|
| 1 | task 1개, shared file 없음, write scope ≤ 5 | orchestrator 불필요, openclaw 직접 |
| 2 | task 2~3개, specialist 2~3명 | orchestrator spawn |
| 3 | task 4+개, specialist 4+명, 또는 아키텍처 변경 | orchestrator spawn + final review 강화 |

**판정 시그널:**
- specialist 1명으로 충분한가? → Tier 1
- 파일 수정 범위가 모듈 2~3개? → Tier 2
- 아키텍처 변경 또는 모듈 4개 이상? → Tier 3

---

## File Structure (Task 전에 먼저)

Task를 정의하기 전에 파일 구조를 먼저 매핑한다:

```markdown
## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | src/feature/handler.ts | 요청 처리 |
| Create | src/feature/handler.test.ts | handler 테스트 |
| Modify | src/index.ts:15-20 | route 등록 |
| Create | src/feature/types.ts | 타입 정의 |
```

원칙:
- 각 파일은 하나의 명확한 책임
- 기존 코드베이스에서는 기존 패턴을 따른다
- 함께 변경되는 파일은 함께 배치
- 책임으로 분리, 기술 레이어로 분리하지 않음

---

## Task 구조

각 task는 **2~5분짜리 단일 작업 단위**다.

````markdown
### Task N: {Component Name}

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/test.ts`

**Dependencies:** Task M (있으면)

- [ ] **Step 1: Write the failing test**

```typescript
// exact test code
describe('feature', () => {
  it('should do X', () => {
    const result = doThing(input);
    expect(result).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --grep "should do X"`
Expected: FAIL with "doThing is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// exact implementation code
export function doThing(input: string): string {
  return expected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --grep "should do X"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/feature/handler.ts tests/feature/handler.test.ts
git commit -m "feat: add doThing handler"
```
````

---

## No Placeholders 규칙

**Plan에 다음을 절대 쓰지 마라:**
- "TBD", "TODO", "implement later"
- "Add appropriate error handling"
- "Write tests for the above" (실제 테스트 코드 없이)
- "Similar to Task N" (코드를 반복해서 적어라)
- 코드 변경을 설명하면서 코드 블록이 없는 step
- Plan 내 다른 task에서 정의되지 않은 타입/함수/메서드 참조

---

## Self-Review (Plan 작성 후)

Plan을 작성한 뒤 스스로 검토한다:

1. **Spec coverage:** 원래 요구사항의 각 항목에 대응하는 task가 있는가?
2. **Placeholder scan:** "No Placeholders" 규칙의 패턴이 있는가?
3. **Type consistency:** Task 3에서 `clearLayers()`라고 했는데 Task 7에서 `clearFullLayers()`라고 하지 않았는가?
4. **File path consistency:** 모든 task의 경로가 File Structure와 일치하는가?

문제를 발견하면 즉시 수정한다.

---

## Task 간 의존성

- 의존성이 있는 task는 **Dependencies:** 필드에 명시
- 순환 의존은 금지
- 가능하면 독립적으로 설계 (병렬은 안 하지만, 의존성이 적을수록 BLOCKED 영향 범위 축소)

---

## Plan → Orchestrator 전달

Plan 완성 후:
1. ReS에게 Plan을 보여주고 검토 요청
2. 승인 후 orchestrator를 spawn하면서 Plan 전체 텍스트를 task에 포함
3. Plan 파일 참조가 아니라 **전체 텍스트를 task에 붙여넣는다**

---

## Red Flags

- ❌ Plan 없이 orchestrator를 spawn하지 마라
- ❌ Step에 코드 없이 "구현하라"라고만 쓰지 마라
- ❌ Task를 10분 이상 걸리는 크기로 만들지 마라
- ❌ 기존 코드를 읽지 않고 Plan을 쓰지 마라
- ❌ Test Command를 header에 빠뜨리지 마라
- ❌ 모호한 수락 기준을 쓰지 마라 ("잘 동작해야 한다" → "X 입력 시 Y를 반환해야 한다")
