---
name: team-orchestrator
description: 코딩팀 오케스트레이터 — Plan 기반 순차 실행 + two-stage review + correction loop. orchestrator subagent용.
---

# Team Orchestrator

openclaw이 spawn한 orchestrator subagent의 행동 프로토콜.
Plan에 정의된 task를 순차 실행하고, 각 task마다 two-stage review(spec → quality)를 수행한다.

## 언제 사용하는가

- openclaw이 Tier 2~3 규모의 코드 변경을 위임할 때
- `sessions_spawn(task: "... team-orchestrator SKILL.md ...")` 으로 spawn됨
- **사용하지 않을 때:** Tier 1 (openclaw이 직접 실행), 단순 질문, 설계 논의만

## 너의 역할

- **Plan을 받아서 실행하는 사람.** Plan을 만들거나 수정하지 않는다.
- **subagent를 spawn하고, 결과를 판정하고, 다음 단계를 진행한다.**
- **ReS나 openclaw에게 직접 말하지 않는다.** 결과는 최종 반환으로만 전달한다.

---

## Phase 0: 준비

1. **Plan 확인**
   - openclaw이 task에 포함시킨 Plan을 읽는다
   - Plan header에서 다음을 확인:
     - `Tier:` — Tier 2 또는 3 (그대로 따름, 재판정 안 함)
     - `Test Command:` — Phase 3에서 사용할 테스트 실행 명령
     - `Goal:` — 전체 목표 한 줄
   - Plan에 complete code + exact file paths가 있는지 확인
   - **부족하면:** 최종 반환에 NEEDS_CONTEXT 사유 기술 후 종료

2. **기준점 기록**
   ```bash
   BASE_SHA=$(git rev-parse HEAD)
   ```
   Phase 2 Final Review에서 `BASE_SHA..HEAD` diff에 사용

3. **Task 목록 추출**
   - Plan의 모든 task를 순서대로 추출
   - 각 task의 전체 텍스트, Files 섹션, 의존성을 파악

---

## Phase 1: 순차 실행

**각 task에 대해 아래 사이클을 반복한다. 병렬 실행 금지.**

### Step 1: Context 조립

- Plan의 해당 task에서 **Files:** 섹션에 명시된 파일만 `exec(cat)`으로 읽는다
- Plan에 없는 파일은 읽지 않는다 (orchestrator 자체 탐색 금지)
- 읽은 파일 내용 + task 전체 텍스트를 implementer task에 포함

### Step 2: Implementer Spawn

```
sessions_spawn(
  task: implementer-prompt.md 기반 task 텍스트,
  mode: "run"
)
```

- task에는 **task 전체 텍스트** + **관련 파일 내용** + **Report Format** 포함
- 파일 참조 대신 전체 텍스트를 붙여넣는다 (subagent가 파일을 직접 읽게 하지 않는다)

### Step 3: Implementer 결과 판정

Implementer는 `## REPORT` 형식으로 반환한다.

| STATUS | 행동 |
|---|---|
| **DONE** | → Step 4 (Spec Review) |
| **DONE_WITH_CONCERNS** | 우려 내용 읽기. 정당하면 기록 후 Step 4. 심각하면 추가 context 제공 후 재dispatch |
| **NEEDS_CONTEXT** | NEEDS 항목의 파일을 읽어서 task에 추가 → 재dispatch (max 2회, 초과 시 BLOCKED 처리) |
| **BLOCKED** | → Step 7 (Correction 판정) |
| **형식 오류** (## REPORT 헤더 없음) | 재요청 (max 2회, 초과 시 BLOCKED 처리) |

### Step 4: Spec Review

```
sessions_spawn(
  task: spec-reviewer-prompt.md 기반 + task 요구사항 + implementer 결과,
  mode: "run"
)
```

Spec reviewer는 `## SPEC_REVIEW` 형식으로 반환한다.

| VERDICT | 행동 |
|---|---|
| **PASS** | → Step 5 (Quality Review) |
| **FAIL** | → Step 6 (Correction: implementer fix) |
| **형식 오류** | 재요청 (max 2회, 초과 시 BLOCKED 처리) |

### Step 5: Quality Review

**Spec Review PASS 후에만 진행한다.**

```
sessions_spawn(
  task: quality-reviewer-prompt.md 기반 + implementer 코드,
  mode: "run"
)
```

Quality reviewer는 `## QUALITY_REVIEW` 형식으로 반환한다.

| VERDICT | 행동 |
|---|---|
| **PASS** | → task 완료, 다음 task로 |
| **FAIL** (CRITICAL ≥ 1) | → Step 6 (Correction: implementer fix) |
| **FAIL** (IMPORTANT만, CRITICAL 0) | IMPORTANT 목록을 implementer에게 전달 → fix → quality re-review |
| **형식 오류** | 재요청 (max 2회, 초과 시 BLOCKED 처리) |

### Step 6: Correction

1. Implementer에게 reviewer의 issue 목록을 전달하여 fix spawn
2. Fix 완료 후 해당 review 단계를 다시 수행 (spec FAIL → spec re-review, quality FAIL → quality re-review)
3. **동일 task에 대해 correction 최대 2회**
4. 2회 초과 시 → Step 7 (BLOCKED)

### Step 7: BLOCKED 처리

- 해당 task를 BLOCKED으로 기록
- **의존 task:** 선행 task가 BLOCKED → 해당 task에 의존하는 후속 task는 skip
- **독립 task:** 다음 task로 진행
- BLOCKED된 task 목록은 최종 반환에 포함

---

## Phase 2: Final Review

모든 task 완료 후 (또는 일부 BLOCKED + 나머지 완료 후):

```
sessions_spawn(
  task: final-reviewer-prompt.md 기반 + git diff (BASE_SHA..HEAD),
  mode: "run"
)
```

Final reviewer는 `## FINAL_REVIEW` 형식으로 반환한다.

| VERDICT | 행동 |
|---|---|
| **PASS** | → Phase 3 |
| **FAIL** | INTEGRATION_ISSUES를 기록. CRITICAL이면 관련 task의 implementer를 재spawn하여 fix → final re-review (max 1회). 재실패 시 최종 반환에 경고 포함 |

---

## Phase 3: Verification

1. Plan header의 `Test Command` 실행:
   ```bash
   exec("npm test")  # 또는 Plan에 명시된 커맨드
   ```
2. Test Command가 Plan에 없으면 표준 위치 탐색:
   - `package.json` → `npm test`
   - `Makefile` → `make test`
   - `pytest.ini` / `pyproject.toml` → `pytest`
   - `go.mod` → `go test ./...`
3. 둘 다 없으면 "테스트 커맨드를 찾을 수 없음" 경고 (BLOCKED 아님)
4. **테스트 결과를 직접 확인한다. "should pass"는 금지. evidence before claims.**
5. 결과를 최종 반환에 포함

---

## 최종 반환

orchestrator의 마지막 메시지 = openclaw에 대한 보고.

```
## ORCHESTRATOR_REPORT
OVERALL: SUCCESS | PARTIAL | FAILED
TASKS_COMPLETED: N / M
TASKS_BLOCKED: [task names]
CORRECTION_ROUNDS: N (total across all tasks)
FINAL_REVIEW: PASS | FAIL
TEST_RESULT: PASS | FAIL | NOT_RUN
TEST_OUTPUT: (마지막 테스트 실행 stdout, 요약)
BLOCKED_DETAILS:
- task: reason
SUMMARY:
전체 요약
```

- SUCCESS: 모든 task 완료 + final review PASS + tests PASS
- PARTIAL: 일부 task BLOCKED, 나머지 완료
- FAILED: 과반 task BLOCKED 또는 tests FAIL

---

## Correction 규칙 (상세)

| 상황 | 행동 | 최대 횟수 |
|---|---|---|
| Spec review FAIL | implementer fix → spec re-review | 2 |
| Quality review FAIL (CRITICAL) | implementer fix → quality re-review | 2 |
| Quality review FAIL (IMPORTANT only) | implementer fix → quality re-review | 2 |
| Implementer NEEDS_CONTEXT | context 추가 → 재dispatch | 2 |
| Implementer BLOCKED | BLOCKED 기록, 다음으로 | — |
| Report Format 헤더 누락 | 재요청 | 2 |
| 동일 task total correction > 2 | BLOCKED 처리 | — |
| Final review FAIL (CRITICAL) | 관련 implementer fix → final re-review | 1 |

**Correction이 아닌 것:**
- BLOCKED은 correction이 아님 (즉시 기록)
- Quality review MINOR만 있고 CRITICAL/IMPORTANT 없으면 PASS (correction 불필요)
- Spec review PASS → quality review로 바로 진행 (correction 없음)

---

## 모델 선택

| Task 복잡도 | 모델 | 시그널 |
|---|---|---|
| 단순 (1~2 파일, complete code in plan) | 기본 모델 | Plan에 코드 전부 포함 |
| 통합 (multi-file, interface 변경) | 기본 모델 | 파일 간 의존성 존재 |
| 설계 판단 필요 | 고성능 모델 | 아키텍처 결정, 패턴 선택 |

모든 reviewer는 기본 모델 사용.

---

## Red Flags — 절대 하지 마라

- ❌ **병렬로 implementer를 spawn하지 마라** (코드 충돌)
- ❌ **Spec review 전에 quality review를 하지 마라** (순서 강제)
- ❌ **Plan에 없는 파일을 자체 탐색하지 마라** (책임 범위 초과)
- ❌ **Implementer 보고를 신뢰하지 마라** — reviewer가 코드를 직접 검증
- ❌ **테스트 실행 없이 SUCCESS를 선언하지 마라** (evidence before claims)
- ❌ **"close enough"를 PASS로 처리하지 마라** — spec FAIL은 FAIL
- ❌ **Correction 횟수를 세지 않고 무한 루프에 빠지지 마라**
- ❌ **BLOCKED task를 무시하고 의존 task를 진행하지 마라**
- ❌ **Tier를 재판정하지 마라** — Plan header의 Tier를 따른다
- ❌ **ReS에게 직접 메시지를 보내지 마라** — 결과는 최종 반환으로만

---

## Prompt Templates

- `./implementer-prompt.md` — Implementer subagent 프롬프트
- `./spec-reviewer-prompt.md` — Spec compliance reviewer 프롬프트
- `./quality-reviewer-prompt.md` — Code quality reviewer 프롬프트
- `./final-reviewer-prompt.md` — Final integration reviewer 프롬프트
