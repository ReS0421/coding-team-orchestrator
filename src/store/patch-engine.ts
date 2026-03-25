import type { ManifestPatchSet, ManifestPatch } from "../schemas/manifest-patch.js";
import type { ManifestArtifact, ProjectManifest, TransitionLogEntry } from "./types.js";
import { ChangeClass } from "../domain/types.js";
import { propagateFreshness } from "./freshness.js";

export interface PatchResult {
  success: boolean;
  manifest: ProjectManifest;
  errors: string[];
}

export interface PatchOptions {
  incrementSeq?: boolean;
}

/**
 * Apply a patch set to a manifest with optimistic concurrency and all_or_fail semantics.
 */
export function applyPatchSet(
  manifest: ProjectManifest,
  patchSet: ManifestPatchSet,
  options?: PatchOptions,
): PatchResult {
  // Optimistic concurrency check
  if (patchSet.base_manifest_seq !== manifest.manifest_seq) {
    return {
      success: false,
      manifest,
      errors: [
        `Manifest seq mismatch: expected ${patchSet.base_manifest_seq}, got ${manifest.manifest_seq}`,
      ],
    };
  }

  // Try applying all patches to a working copy
  let working: ProjectManifest = {
    ...manifest,
    artifacts: manifest.artifacts.map((a) => ({ ...a })),
  };
  const errors: string[] = [];

  for (const patch of patchSet.patches) {
    const result = applySinglePatch(working, patch);
    if (result.error) {
      errors.push(result.error);
    } else {
      working = result.manifest!;
    }
  }

  // all_or_fail: if any errors, return original manifest
  if (errors.length > 0) {
    return { success: false, manifest, errors };
  }

  // Success: increment manifest_seq unless opted out
  const shouldIncrement = options?.incrementSeq !== false;
  return {
    success: true,
    manifest: shouldIncrement
      ? { ...working, manifest_seq: working.manifest_seq + 1 }
      : working,
    errors: [],
  };
}

interface SinglePatchResult {
  manifest?: ProjectManifest;
  error?: string;
}

function applySinglePatch(
  manifest: ProjectManifest,
  patch: ManifestPatch,
): SinglePatchResult {
  const idx = manifest.artifacts.findIndex(
    (a) => a.id === patch.artifact_id,
  );
  if (idx === -1) {
    return { error: `Artifact '${patch.artifact_id}' not found` };
  }

  const artifact = manifest.artifacts[idx];
  const field = patch.field as keyof ManifestArtifact;
  const currentValue = artifact[field];

  // old_value check (optimistic concurrency per field)
  if (patch.old_value !== undefined) {
    if (!deepEqual(currentValue, patch.old_value)) {
      return {
        error: `Field '${patch.field}' of '${patch.artifact_id}': expected old_value ${JSON.stringify(patch.old_value)}, got ${JSON.stringify(currentValue)}`,
      };
    }
  }

  const newArtifacts = [...manifest.artifacts];
  const updatedArtifact = { ...artifact };

  switch (patch.op) {
    case "set":
      (updatedArtifact as Record<string, unknown>)[patch.field] = patch.new_value;
      break;

    case "increment": {
      if (currentValue !== undefined && typeof currentValue !== "number") {
        return { error: `Field '${patch.field}' of '${patch.artifact_id}': expected number for increment, got ${typeof currentValue}` };
      }
      if (typeof patch.new_value !== "number") {
        return { error: `Increment new_value must be number for '${patch.field}' of '${patch.artifact_id}', got ${typeof patch.new_value}` };
      }
      const cur = (currentValue as number) ?? 0;
      const inc = patch.new_value;
      (updatedArtifact as Record<string, unknown>)[patch.field] = cur + inc;
      break;
    }

    case "append": {
      const arr = Array.isArray(currentValue)
        ? [...currentValue]
        : [];
      arr.push(patch.new_value as string);
      (updatedArtifact as Record<string, unknown>)[patch.field] = arr;
      break;
    }
  }

  newArtifacts[idx] = updatedArtifact;
  return { manifest: { ...manifest, artifacts: newArtifacts } };
}

export interface PatchSetFullOptions {
  changeClass?: ChangeClass;
  timestamp?: string;
}

export interface PatchSetFullResult {
  success: boolean;
  manifest: ProjectManifest;
  errors: string[];
  transitions: TransitionLogEntry[];
}

/**
 * Apply a patch set with full manifest lifecycle: patch → freshness → transitions → seq+1 (once).
 */
export function applyPatchSetFull(
  manifest: ProjectManifest,
  patchSet: ManifestPatchSet,
  options?: PatchSetFullOptions,
): PatchSetFullResult {
  const changeClass = options?.changeClass ?? ChangeClass.STRUCTURAL;
  const ts = options?.timestamp ?? new Date().toISOString();

  // Apply patches without incrementing seq
  const patchResult = applyPatchSet(manifest, patchSet, { incrementSeq: false });
  if (!patchResult.success) {
    return {
      success: false,
      manifest,
      errors: patchResult.errors,
      transitions: [],
    };
  }

  let working = patchResult.manifest;

  // Identify content_rev changes by comparing original to patched
  const contentRevChanges: Array<{ artifactId: string; fromRev: number; toRev: number }> = [];
  for (const patch of patchSet.patches) {
    if (patch.field === "content_rev") {
      const original = manifest.artifacts.find((a) => a.id === patch.artifact_id);
      const updated = working.artifacts.find((a) => a.id === patch.artifact_id);
      if (original && updated && original.content_rev !== updated.content_rev) {
        // Dedup
        if (!contentRevChanges.some((c) => c.artifactId === patch.artifact_id)) {
          contentRevChanges.push({
            artifactId: patch.artifact_id,
            fromRev: original.content_rev,
            toRev: updated.content_rev,
          });
        }
      }
    }
  }

  // Propagate freshness for each changed artifact
  const transitions: TransitionLogEntry[] = [];
  const newSeq = manifest.manifest_seq + 1;

  for (const change of contentRevChanges) {
    const prePropagate = working;
    working = propagateFreshness(working, change.artifactId, changeClass);

    // Record invalidated artifacts
    const invalidated: Array<{ artifact_id: string; freshness_change: string }> = [];
    for (let i = 0; i < working.artifacts.length; i++) {
      const before = prePropagate.artifacts[i];
      const after = working.artifacts[i];
      if (before.freshness !== after.freshness) {
        invalidated.push({
          artifact_id: after.id,
          freshness_change: `${before.freshness ?? "undefined"} → ${after.freshness}`,
        });
      }
    }

    transitions.push({
      artifact_id: change.artifactId,
      from_content_rev: change.fromRev,
      to_content_rev: change.toRev,
      manifest_seq_at: newSeq,
      change_class: changeClass,
      reason: `patch applied`,
      timestamp: ts,
      ...(invalidated.length > 0 ? { invalidated } : {}),
    });
  }

  // Increment manifest_seq once
  return {
    success: true,
    manifest: {
      ...working,
      manifest_seq: newSeq,
      transitions: [...manifest.transitions, ...transitions],
    },
    errors: [],
    transitions,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((k, i) => k === bKeys[i])) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}
