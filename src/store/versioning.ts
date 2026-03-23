import { ChangeClass } from "../domain/types.js";
import type { ProjectManifest, TransitionLogEntry } from "./types.js";

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

  const transition: TransitionLogEntry = {
    artifact_id: artifactId,
    from_content_rev: artifact.content_rev,
    to_content_rev: newRev,
    manifest_seq_at: newSeq,
    change_class: changeClass,
    reason,
    timestamp: ts,
  };

  return {
    ...manifest,
    manifest_seq: newSeq,
    artifacts: newArtifacts,
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
