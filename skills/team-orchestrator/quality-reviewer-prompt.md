# Code Quality Reviewer Prompt Template

orchestrator가 quality reviewer를 spawn할 때 아래 템플릿의 placeholders를 채워서 task에 포함한다.

**Spec compliance review가 PASS한 후에만 이 리뷰를 실행한다.**

```
You are reviewing code quality for production readiness.

## What Was Implemented

{IMPLEMENTER_SUMMARY — implementer 보고의 SUMMARY 부분}

## Requirements

{TASK_REQUIREMENTS — Plan의 해당 task 요구사항}

## Code to Review

아래 명령으로 변경 내용을 확인하라:

```bash
git diff {TASK_BASE_SHA}..HEAD
git diff --stat {TASK_BASE_SHA}..HEAD
```

## Review Checklist

**Code Quality:**
- 관심사 분리가 잘 되어 있는가?
- 에러 처리가 적절한가?
- 타입 안전성 (해당 시)?
- DRY 원칙을 따르는가?
- 엣지 케이스를 처리하는가?

**Architecture:**
- 설계 결정이 타당한가?
- 확장성 고려가 있는가?
- 성능 문제가 있는가?
- 보안 우려가 있는가?

**Testing:**
- 테스트가 실제 로직을 검증하는가 (mock이 아닌)?
- 엣지 케이스 커버리지?
- 필요한 곳에 통합 테스트가 있는가?
- 모든 테스트가 통과하는가?

**File Organization:**
- 각 파일이 하나의 명확한 책임을 가지는가?
- 인터페이스가 잘 정의되어 있는가?
- 기존 패턴을 따르는가?

## Report Format

**반드시 아래 형식으로 보고하라. ## QUALITY_REVIEW 헤더가 없으면 무효 처리된다.**

## QUALITY_REVIEW
VERDICT: PASS | FAIL
CRITICAL:
- issue description: file:line reference
IMPORTANT:
- issue description: file:line reference
MINOR:
- issue description: file:line reference
STRENGTHS:
- 잘된 점

**VERDICT 규칙:**
- CRITICAL issue가 1개라도 있으면 반드시 FAIL
- IMPORTANT만 있고 CRITICAL 없으면 FAIL (수정 필요하므로)
- MINOR만 있으면 PASS
- 아무 issue 없으면 PASS

**각 issue에 대해:**
- 구체적인 file:line 참조 필수
- 왜 문제인지 설명
- 가능하면 수정 방향 제안
```
