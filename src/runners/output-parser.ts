import { z } from "zod";
import type { DispatchCard } from "../schemas/dispatch-card.js";
import type { RunnerReturn } from "./types.js";
import { PlannerReturnSchema } from "../schemas/planner-return.js";
import { SpecialistSubmissionSchema } from "../schemas/specialist-submission.js";
import { ReviewerReturnSchema } from "../schemas/reviewer-return.js";
import { LeadReturnSchema } from "../schemas/lead-return.js";

/**
 * Custom error for spawn output parsing failures.
 */
export class SpawnOutputParseError extends Error {
  constructor(
    public readonly role: string,
    public readonly rawOutput: string,
    public readonly zodErrors?: z.ZodError,
  ) {
    super(
      `Failed to parse ${role} output: ${zodErrors?.message ?? "No valid JSON found"}`,
    );
    this.name = "SpawnOutputParseError";
  }
}

/**
 * Extract JSON from various output formats.
 *
 * Strategy (in order):
 * 1. Entire string is valid JSON
 * 2. Last ```json ... ``` fenced block
 * 3. Last balanced { ... } block
 */
export function extractJSON(raw: string): string {
  const trimmed = raw.trim();

  // Strategy 1: entire string is JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // fall through
    }
  }

  // Strategy 2: last fenced json block
  const fencedMatches = [...trimmed.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (fencedMatches.length > 0) {
    const lastFenced = fencedMatches[fencedMatches.length - 1][1].trim();
    try {
      JSON.parse(lastFenced);
      return lastFenced;
    } catch {
      // fall through
    }
  }

  // Strategy 3: last balanced { ... } block
  const lastBrace = findLastBalancedBraces(trimmed);
  if (lastBrace) {
    try {
      JSON.parse(lastBrace);
      return lastBrace;
    } catch {
      // fall through
    }
  }

  throw new SpawnOutputParseError("unknown", raw);
}

/**
 * Find the last balanced { ... } block in the string.
 */
function findLastBalancedBraces(str: string): string | null {
  let depth = 0;
  let end = -1;

  // Find the last } and work backward to find its matching {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === "}" && end === -1) {
      end = i;
      depth = 1;
    } else if (end !== -1) {
      if (str[i] === "}") depth++;
      if (str[i] === "{") depth--;
      if (depth === 0) {
        return str.slice(i, end + 1);
      }
    }
  }
  return null;
}

/**
 * Select the Zod schema for a given role.
 */
function schemaForRole(role: DispatchCard["role"]): z.ZodType {
  switch (role) {
    case "planner":
      return PlannerReturnSchema;
    case "specialist":
    case "shared_owner":
      return SpecialistSubmissionSchema;
    case "reviewer":
      return ReviewerReturnSchema;
    case "execution_lead":
      return LeadReturnSchema;
    default:
      return SpecialistSubmissionSchema;
  }
}

/**
 * Parse raw subagent/ACP output into a typed RunnerReturn.
 */
export function parseSpawnOutput(
  card: DispatchCard,
  raw: string,
): RunnerReturn {
  if (!raw || raw.trim().length === 0) {
    throw new SpawnOutputParseError(card.role, raw);
  }

  let jsonStr: string;
  try {
    jsonStr = extractJSON(raw);
  } catch {
    throw new SpawnOutputParseError(card.role, raw);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new SpawnOutputParseError(card.role, raw);
  }

  const schema = schemaForRole(card.role);
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new SpawnOutputParseError(card.role, raw, result.error);
  }

  return result.data as RunnerReturn;
}
