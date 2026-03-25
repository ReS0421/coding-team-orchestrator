import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { ManifestPatchSet, ManifestPatch } from "../schemas/manifest-patch.js";
import type { ProjectManifest } from "../store/types.js";

/**
 * Mapping from file paths to artifact IDs.
 * Used for explicit overrides when auto-matching is insufficient.
 */
export interface ArtifactMapping {
  [filePath: string]: string;
}

/**
 * Build a patch set from a single specialist submission.
 * Matches touched_files to manifest artifacts by exact path or directory prefix match.
 */
export function buildPatchSetFromSubmission(
  submission: SpecialistSubmission,
  manifest: ProjectManifest,
  mapping?: ArtifactMapping,
  specialistId?: string,
): ManifestPatchSet | null {
  const patches = buildPatches(submission, manifest, mapping, new Set(), specialistId);
  if (patches.length === 0) return null;

  return {
    base_manifest_seq: manifest.manifest_seq,
    apply_mode: "all_or_fail",
    patches,
  };
}

/**
 * Build a combined patch set from multiple specialist submissions.
 * Deduplicates artifacts via seen Set. Uses deferred commit pattern
 * to prevent manifest_seq conflicts in shared paths.
 *
 * @param entries - Array of [submission, specialistId] tuples
 */
export function buildCombinedPatchSet(
  submissions: SpecialistSubmission[],
  manifest: ProjectManifest,
  mapping?: ArtifactMapping,
  specialistIds?: string[],
): ManifestPatchSet | null {
  const seen = new Set<string>();
  const allPatches: ManifestPatch[] = [];

  for (let i = 0; i < submissions.length; i++) {
    const submission = submissions[i];
    const specialistId = specialistIds?.[i];
    const patches = buildPatches(submission, manifest, mapping, seen, specialistId);
    allPatches.push(...patches);
  }

  if (allPatches.length === 0) return null;

  return {
    base_manifest_seq: manifest.manifest_seq,
    apply_mode: "all_or_fail",
    patches: allPatches,
  };
}

function buildPatches(
  submission: SpecialistSubmission,
  manifest: ProjectManifest,
  mapping: ArtifactMapping | undefined,
  seen: Set<string>,
  specialistId?: string,
): ManifestPatch[] {
  const patches: ManifestPatch[] = [];
  const id = specialistId ?? "unknown";

  for (const file of submission.touched_files) {
    // Resolve artifact id via explicit mapping or auto-match
    const artifactId = resolveArtifactId(file, manifest, mapping);
    if (!artifactId) continue;
    if (seen.has(artifactId)) continue;
    seen.add(artifactId);

    const artifact = manifest.artifacts.find((a) => a.id === artifactId);
    if (!artifact) continue;

    patches.push({
      artifact_id: artifactId,
      op: "increment",
      field: "content_rev",
      old_value: artifact.content_rev,
      new_value: 1,
      reason: `Updated by specialist: ${id}`,
    });
  }

  return patches;
}

function resolveArtifactId(
  file: string,
  manifest: ProjectManifest,
  mapping?: ArtifactMapping,
): string | undefined {
  // Explicit mapping takes priority
  if (mapping && mapping[file]) {
    const mapped = mapping[file];
    if (manifest.artifacts.some((a) => a.id === mapped)) return mapped;
  }

  // Exact match by path
  const exact = manifest.artifacts.find((a) => a.path === file);
  if (exact) return exact.id;

  // Directory prefix match: file is under artifact path directory
  for (const a of manifest.artifacts) {
    if (file.startsWith(a.path + "/")) return a.id;
  }

  return undefined;
}
