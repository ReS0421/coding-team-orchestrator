import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { ReviewerReturn } from "../schemas/reviewer-return.js";
import { safeValidateReviewerReturn } from "../schemas/reviewer-return.js";
import type { RunnerFn } from "../runners/types.js";

export interface DualReviewConfig {
  spec_reviewer_card: DispatchCard;
  quality_reviewer_card: DispatchCard;
  runner: RunnerFn;
}

export interface DualReviewResult {
  spec_review: ReviewerReturn;
  quality_review: ReviewerReturn;
  merged_issues: ReviewerReturn["issues"];
  disposition: "PASS" | "FAIL";
}

/**
 * Run dual review: spec-reviewer + quality-reviewer in parallel.
 * Results merged; blocking issue in either → FAIL.
 * Independence preserved: quality reviewer does NOT receive spec reviewer results.
 */
export async function runDualReview(
  config: DualReviewConfig,
): Promise<DualReviewResult> {
  const { spec_reviewer_card, quality_reviewer_card, runner } = config;

  // Run both reviewers in parallel (independent — no cross-feed)
  const [specRaw, qualityRaw] = await Promise.all([
    runner(spec_reviewer_card),
    runner(quality_reviewer_card),
  ]);

  const specValidation = safeValidateReviewerReturn(specRaw);
  const qualityValidation = safeValidateReviewerReturn(qualityRaw);

  if (!specValidation.success) {
    throw new Error("Spec reviewer returned malformed data");
  }
  if (!qualityValidation.success) {
    throw new Error("Quality reviewer returned malformed data");
  }

  const specReview = specValidation.data;
  const qualityReview = qualityValidation.data;

  const mergedIssues = mergeReviewIssues(specReview.issues, qualityReview.issues);
  const hasBlocking = mergedIssues.some((i) => i.blocking);
  const disposition: "PASS" | "FAIL" = hasBlocking ? "FAIL" : "PASS";

  return {
    spec_review: specReview,
    quality_review: qualityReview,
    merged_issues: mergedIssues,
    disposition,
  };
}

/**
 * Merge review issues from spec and quality reviewers.
 * - Same issue_id: higher severity wins (critical > major > minor).
 * - Different issue_ids: all included.
 * Severity order: critical > major > minor
 */
export function mergeReviewIssues(
  specIssues: ReviewerReturn["issues"],
  qualityIssues: ReviewerReturn["issues"],
): ReviewerReturn["issues"] {
  const severityOrder: Record<string, number> = {
    critical: 3,
    major: 2,
    minor: 1,
  };

  const issueMap = new Map<string, ReviewerReturn["issues"][number]>();

  for (const issue of specIssues) {
    issueMap.set(issue.issue_id, issue);
  }

  for (const issue of qualityIssues) {
    const existing = issueMap.get(issue.issue_id);
    if (!existing) {
      issueMap.set(issue.issue_id, issue);
    } else {
      // Higher severity wins
      if (severityOrder[issue.severity] > severityOrder[existing.severity]) {
        issueMap.set(issue.issue_id, issue);
      }
    }
  }

  return Array.from(issueMap.values());
}
