import type { DispatchCard } from "../schemas/dispatch-card.js";

export interface TaskTemplateConfig {
  projectPath: string;
  designDocPaths?: string[];
  codebaseSummary?: string;
}

/**
 * Convert a DispatchCard into a task string for sessions_spawn.
 * Each role gets a tailored persona + instructions + return format.
 */
export function buildTaskTemplate(
  card: DispatchCard,
  config: TaskTemplateConfig,
): string {
  const sections: string[] = [];

  switch (card.role) {
    case "planner":
      sections.push(buildPlannerTemplate(card, config));
      break;
    case "specialist":
    case "shared_owner":
      sections.push(buildSpecialistTemplate(card, config));
      break;
    case "reviewer":
      sections.push(buildReviewerTemplate(card, config));
      break;
    case "execution_lead":
      sections.push(buildLeadTemplate(card, config));
      break;
  }

  sections.push(buildReturnInstruction(card));
  return sections.join("\n\n");
}

/**
 * Build the return format instruction based on role.
 */
export function buildReturnInstruction(card: DispatchCard): string {
  const schemaMap: Record<string, string> = {
    planner: `{
  "tasks_md": "string (required) — 구현 계획 markdown",
  "brief_md": "string (optional) — brief markdown",
  "tier_recommendation": "1 | 2 | 3 (optional)"
}`,
    specialist: `{
  "status": "done | done_with_concerns | blocked",
  "touched_files": ["string[]"],
  "changeset": "string — 변경 요약",
  "delta_stub": "string — diff stub",
  "evidence": { "build_pass": true, "test_pass": true, "test_summary": "string" }
}`,
    shared_owner: `{
  "status": "done | done_with_concerns | blocked",
  "touched_files": ["string[]"],
  "changeset": "string — 변경 요약",
  "delta_stub": "string — diff stub",
  "evidence": { "build_pass": true, "test_pass": true, "test_summary": "string" }
}`,
    reviewer: `{
  "review_report": "string (required) — 리뷰 보고",
  "disposition_recommendation": "PASS | FAIL | CONDITIONAL",
  "issues": [{ "issue_id": "string", "severity": "critical|major|minor", "blocking": true, "evidence": "string" }],
  "cross_check": [{ "check": "scope_violation|shared_file|interface_mismatch|test_coverage|goal_met", "pass": true }]
}`,
    execution_lead: `{
  "final_merge_candidate": true,
  "execution_summary": "string",
  "specialist_results": [SpecialistSubmission[]],
  "manifest_updates": { "base_manifest_seq": 0, "apply_mode": "all_or_fail", "patches": [...] }
}`,
  };

  return `## 반환 형식

작업 완료 후 아래 JSON 형식으로 반환하라. 반드시 유효한 JSON이어야 한다.

\`\`\`json
${schemaMap[card.role] ?? schemaMap["specialist"]}
\`\`\``;
}

function buildPlannerTemplate(card: DispatchCard, config: TaskTemplateConfig): string {
  const lines: string[] = [
    "너는 시니어 소프트웨어 아키텍트다.",
    "",
    `프로젝트: ${config.projectPath}`,
    `목표: ${card.task}`,
  ];

  if (config.designDocPaths?.length) {
    lines.push("", "참조 문서 (읽기만, 수정 금지):");
    for (const p of config.designDocPaths) {
      lines.push(`- ${p}`);
    }
  }

  if (config.codebaseSummary) {
    lines.push("", "코드베이스 요약:", config.codebaseSummary);
  }

  lines.push(
    "",
    "다음을 수행하라:",
    "1. 프로젝트 코드를 읽고 현재 상태를 파악",
    "2. task를 분석하고 구현 계획(tasks_md)을 작성",
    "3. specialist 배정, scope, shared surface 정의를 포함한 brief 작성",
  );

  if (card.must_read.length > 0) {
    lines.push("", "반드시 읽을 파일:", ...card.must_read.map(f => `- ${f}`));
  }

  return lines.join("\n");
}

function buildSpecialistTemplate(card: DispatchCard, config: TaskTemplateConfig): string {
  const persona = card.role === "shared_owner"
    ? "너는 shared surface 관리 전문 시니어 TypeScript 개발자다."
    : "너는 시니어 TypeScript 개발자다.";

  const lines: string[] = [
    persona,
    "",
    `프로젝트: ${config.projectPath}`,
    `담당 태스크: ${card.task}`,
  ];

  if (card.role === "shared_owner" && card.priority_task) {
    lines.push("", `선행 작업 (최우선): ${card.priority_task}`);
  }

  if (card.must_read.length > 0) {
    lines.push("", "읽어야 할 파일:", ...card.must_read.map(f => `- ${f}`));
  }

  if (card.write_scope.length > 0) {
    lines.push("", "작업 범위 (이 파일만 수정 가능):", ...card.write_scope.map(f => `- ${f}`));
  }

  if (card.forbidden_paths?.length) {
    lines.push("", "금지 경로 (절대 수정 금지):", ...card.forbidden_paths.map(f => `- ${f}`));
  }

  if (card.authoritative_artifact.length > 0) {
    lines.push("", "권위적 산출물 (이 파일의 정본은 너다):", ...card.authoritative_artifact.map(f => `- ${f}`));
  }

  if (card.completion_check.length > 0) {
    lines.push("", "완료 기준:", ...card.completion_check.map(c => `- ${c}`));
  }

  lines.push(
    "",
    "매 변경 후 반드시 실행:",
    "- npx vitest run (모든 테스트 통과)",
    "- npx tsc --noEmit (타입 에러 없음)",
  );

  return lines.join("\n");
}

function buildReviewerTemplate(card: DispatchCard, config: TaskTemplateConfig): string {
  const lines: string[] = [
    "너는 코드 리뷰어다. 코드를 수정하지 않는다.",
    "",
    `프로젝트: ${config.projectPath}`,
  ];

  if (card.input_refs.length > 0) {
    lines.push("", "검토 대상:", ...card.input_refs.map(r => `- ${r}`));
  }

  if (card.must_read.length > 0) {
    lines.push("", "참조 파일:", ...card.must_read.map(f => `- ${f}`));
  }

  if (card.completion_check.length > 0) {
    lines.push("", "검토 기준:", ...card.completion_check.map(c => `- ${c}`));
  }

  lines.push(
    "",
    "중요: 코드를 직접 수정하지 마라. 리뷰 보고만 작성하라.",
    "scope 위반, shared file 충돌, 인터페이스 불일치, 테스트 커버리지, 목표 달성 여부를 검토하라.",
  );

  return lines.join("\n");
}

function buildLeadTemplate(card: DispatchCard, config: TaskTemplateConfig): string {
  const lines: string[] = [
    "너는 execution lead다. specialist들의 작업을 관리한다.",
    "",
    `프로젝트: ${config.projectPath}`,
    `실행 계획: ${card.task}`,
  ];

  if (card.specialist_assignments?.length) {
    lines.push("", "Specialist 배정:", JSON.stringify(card.specialist_assignments, null, 2));
  }

  if (card.active_span) {
    lines.push("", `Active span: ${card.active_span} (동시 실행 최대 수)`);
  }

  if (card.must_read.length > 0) {
    lines.push("", "읽어야 할 파일:", ...card.must_read.map(f => `- ${f}`));
  }

  lines.push(
    "",
    "다음을 수행하라:",
    "1. Execution contract 확인",
    "2. Shared owner 먼저 spawn (있을 경우)",
    "3. Rolling dispatch로 specialist 실행 (active span 제한)",
    "4. 완료 시 최종 merge candidate 준비",
    "5. manifest_updates로 변경사항 일괄 반환",
  );

  return lines.join("\n");
}
