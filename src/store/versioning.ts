import { ChangeClass } from "../domain/types.js";
import type { ProjectManifest, TransitionLogEntry } from "./types.js";
import { propagateFreshness } from "./freshness.js";

/**
 * Determine if content_rev should increment for a given change class.
 * structural, behavioral, scope → true; cosmetic → false.
 */
export function shouldIncrementContentRev(changeClass: ChangeClass): boolean {
  return changeClass !== ChangeClass.COSMETIC;
}

/**
 * Increment content_rev for an artifact, bump manifest_seq, and add a transition log entry.
 * Returns a new manifest (immutable).
 */
export function incrementContentRev(
  manifest: ProjectManifest,
  artifactId: string,
  changeClass: ChangeClass,
  reason: string,
  timestamp?: string,
): ProjectManifest {
  const idx = manifest.artifacts.findIndex((a) => a.id === artifactId);
  if (idx === -1) {
    throw new Error(`Artifact '${artifactId}' not found in manifest`);
  }

  const artifact = manifest.artifacts[idx];
  const newRev = artifact.content_rev + 1;
  const newSeq = manifest.manifest_seq + 1;
  const ts = timestamp ?? new Date().toISOString();

  const newArtifacts = [...manifest.artifacts];
  newArtifacts[idx] = { ...artifact, content_rev: newRev };

  // Propagate freshness and record invalidated artifacts
  const prePropagate = { ...manifest, artifacts: newArtifacts };
  const postPropagate = propagateFreshness(prePropagate, artifactId, changeClass);

  const invalidated: Array<{ artifact_id: string; freshness_change: string }> = [];
  for (let i = 0; i < postPropagate.artifacts.length; i++) {
    const before = prePropagate.artifacts[i];
    const after = postPropagate.artifacts[i];
    if (before.freshness !== after.freshness) {
      invalidated.push({
        artifact_id: after.id,
        freshness_change: `${before.freshness ?? "undefined"} → ${after.freshness}`,
      });
    }
  }

  const transition: TransitionLogEntry = {
    artifact_id: artifactId,
    from_content_rev: artifact.content_rev,
    to_content_rev: newRev,
    manifest_seq_at: newSeq,
    change_class: changeClass,
    reason,
    timestamp: ts,
    ...(invalidated.length > 0 ? { invalidated } : {}),
  };

  return {
    ...postPropagate,
    manifest_seq: newSeq,
    transitions: [...manifest.transitions, transition],
  };
}

/**
 * Increment only manifest_seq (no content change). Returns a new manifest.
 */
export function incrementManifestSeq(
  manifest: ProjectManifest,
): ProjectManifest {
  return {
    ...manifest,
    manifest_seq: manifest.manifest_seq + 1,
  };
}
