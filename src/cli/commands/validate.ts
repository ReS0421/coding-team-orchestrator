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
