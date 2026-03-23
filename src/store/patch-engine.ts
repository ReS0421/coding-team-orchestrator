import type { ManifestPatchSet, ManifestPatch } from "../schemas/manifest-patch.js";
import type { ManifestArtifact, ProjectManifest } from "./types.js";

export interface PatchResult {
  success: boolean;
  manifest: ProjectManifest;
  errors: string[];
}

/**
 * Apply a patch set to a manifest with optimistic concurrency and all_or_fail semantics.
 */
export function applyPatchSet(
  manifest: ProjectManifest,
  patchSet: ManifestPatchSet,
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

  // Success: increment manifest_seq
  return {
    success: true,
    manifest: { ...working, manifest_seq: working.manifest_seq + 1 },
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
      const cur = (currentValue as number) ?? 0;
      const inc = patch.new_value as number;
      if (typeof cur !== "number" || typeof inc !== "number") {
        return {
          error: `Increment requires numeric values for '${patch.field}' of '${patch.artifact_id}'`,
        };
      }
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

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
