import type { SpecialistSubmission } from "../schemas/specialist-submission.js";
import type { ManifestPatchSet, ManifestPatch } from "../schemas/manifest-patch.js";
import type { ProjectManifest } from "../store/types.js";

/**
 * Build a patch set from a single specialist submission.
 * Matches touched_files to manifest artifacts by exact path or prefix match.
 */
export function buildPatchSetFromSubmission(
  submission: SpecialistSubmission,
  manifest: ProjectManifest,
  mapping?: Record<string, string>,
): ManifestPatchSet | null {
  const patches = buildPatches(submission, manifest, mapping, new Set());
  if (patches.length === 0) return null;

  return {
    base_manifest_seq: manifest.manifest_seq,
    apply_mode: "all_or_fail",
    patches,
  };
}

/**
 * Build a combined patch set from multiple specialist submissions.
 * Deduplicates artifacts via seen Set.
 */
export function buildCombinedPatchSet(
  submissions: SpecialistSubmission[],
  manifest: ProjectManifest,
  mapping?: Record<string, string>,
): ManifestPatchSet | null {
  const seen = new Set<string>();
  const allPatches: ManifestPatch[] = [];

  for (const submission of submissions) {
    const patches = buildPatches(submission, manifest, mapping, seen);
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
  mapping: Record<string, string> | undefined,
  seen: Set<string>,
): ManifestPatch[] {
  const patches: ManifestPatch[] = [];

  for (const file of submission.touched_files) {
    // Resolve artifact id via explicit mapping or auto-match
    const artifactId = resolveArtifactId(file, manifest, mapping);
    if (!artifactId) continue;
    if (seen.has(artifactId)) continue;
    seen.add(artifactId);

    patches.push({
      artifact_id: artifactId,
      op: "increment",
      field: "content_rev",
      new_value: 1,
      reason: `specialist updated ${file}`,
    });
  }

  return patches;
}

function resolveArtifactId(
  file: string,
  manifest: ProjectManifest,
  mapping?: Record<string, string>,
): string | undefined {
  // Explicit mapping takes priority
  if (mapping && mapping[file]) {
    const mapped = mapping[file];
    if (manifest.artifacts.some((a) => a.id === mapped)) return mapped;
  }

  // Exact match by path
  const exact = manifest.artifacts.find((a) => a.path === file);
  if (exact) return exact.id;

  // Prefix match: file starts with artifact path (without extension)
  for (const a of manifest.artifacts) {
    const basePath = a.path.replace(/\.[^.]+$/, "");
    if (file.startsWith(basePath)) return a.id;
  }

  return undefined;
}
