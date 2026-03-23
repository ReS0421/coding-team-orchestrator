import { ArtifactFamily, ChangeClass, Freshness } from "../domain/types.js";
import type { ProjectManifest } from "./types.js";

/**
 * Get IDs of artifacts that directly depend on changedId.
 */
export function getDirectDependents(
  manifest: ProjectManifest,
  changedId: string,
): string[] {
  return manifest.artifacts
    .filter((a) => a.depends_on?.includes(changedId))
    .map((a) => a.id);
}

/**
 * Compute new freshness for a dependent artifact.
 * Returns the new freshness value or null if no change.
 *
 * Rules:
 * - structural + shared surface (control family) → stale_hard
 * - structural + normal dependency → stale_soft
 * - behavioral + direct dependency → stale_soft
 * - scope → control family only → stale_soft
 * - cosmetic → no propagation
 */
export function computeFreshness(
  currentFreshness: Freshness | undefined,
  changeClass: ChangeClass,
  isSharedSurface: boolean,
): Freshness | null {
  if (changeClass === ChangeClass.COSMETIC) return null;

  if (changeClass === ChangeClass.STRUCTURAL) {
    if (isSharedSurface) return Freshness.STALE_HARD;
    return Freshness.STALE_SOFT;
  }

  if (changeClass === ChangeClass.BEHAVIORAL) {
    return Freshness.STALE_SOFT;
  }

  // scope — only affects control family, but that's checked in propagateFreshness
  if (changeClass === ChangeClass.SCOPE) {
    return Freshness.STALE_SOFT;
  }

  return null;
}

/**
 * Propagate freshness changes through the manifest after an artifact change.
 * Returns a new manifest with updated freshness values.
 *
 * Propagation rules:
 * - structural: normal deps → stale_soft, shared/control deps → stale_hard
 * - behavioral: direct deps → stale_soft
 * - scope: control family deps only → stale_soft
 * - cosmetic: no propagation
 */
export function propagateFreshness(
  manifest: ProjectManifest,
  changedArtifactId: string,
  changeClass: ChangeClass,
): ProjectManifest {
  if (changeClass === ChangeClass.COSMETIC) return manifest;

  const dependents = getDirectDependents(manifest, changedArtifactId);
  if (dependents.length === 0) return manifest;

  let result = { ...manifest, artifacts: [...manifest.artifacts] };

  for (const depId of dependents) {
    const idx = result.artifacts.findIndex((a) => a.id === depId);
    if (idx === -1) continue;

    const dep = result.artifacts[idx];

    // scope only propagates to control family
    if (changeClass === ChangeClass.SCOPE && dep.family !== ArtifactFamily.CONTROL) {
      continue;
    }

    const isShared = dep.family === ArtifactFamily.CONTROL;
    const newFreshness = computeFreshness(dep.freshness, changeClass, isShared);

    if (newFreshness !== null) {
      const updated = [...result.artifacts];
      updated[idx] = { ...dep, freshness: newFreshness };
      result = { ...result, artifacts: updated };
    }
  }

  return result;
}
