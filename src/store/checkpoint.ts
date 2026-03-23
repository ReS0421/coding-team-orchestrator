import type {
  CheckpointEntry,
  ManifestArtifact,
  ProjectManifest,
} from "./types.js";

/**
 * Create a checkpoint snapshot of the current manifest state.
 * Stores artifacts_snapshot (ManifestArtifact fields only), increments manifest_seq.
 */
export function createCheckpoint(
  manifest: ProjectManifest,
  timestamp?: string,
): ProjectManifest {
  const ts = timestamp ?? new Date().toISOString();
  const newSeq = manifest.manifest_seq + 1;

  const checkpoint: CheckpointEntry = {
    checkpoint_id: `cp-${newSeq}`,
    manifest_seq: newSeq,
    timestamp: ts,
    artifacts_snapshot: manifest.artifacts.map((a) => ({ ...a })),
  };

  return {
    ...manifest,
    manifest_seq: newSeq,
    checkpoints: [...manifest.checkpoints, checkpoint],
  };
}

/**
 * Restore manifest artifacts from a checkpoint.
 * Increments manifest_seq and adds a rollback transition.
 */
export function restoreFromCheckpoint(
  manifest: ProjectManifest,
  checkpointId: string,
  reason: string,
  timestamp?: string,
): ProjectManifest {
  const cp = manifest.checkpoints.find(
    (c) => c.checkpoint_id === checkpointId,
  );
  if (!cp) {
    throw new Error(`Checkpoint '${checkpointId}' not found`);
  }

  const ts = timestamp ?? new Date().toISOString();
  const newSeq = manifest.manifest_seq + 1;

  return {
    ...manifest,
    manifest_seq: newSeq,
    artifacts: cp.artifacts_snapshot.map((a) => ({ ...a })),
    transitions: [
      ...manifest.transitions,
      {
        artifact_id: "_rollback",
        from_content_rev: 0,
        to_content_rev: 0,
        manifest_seq_at: newSeq,
        change_class: "structural" as const,
        reason: `Rollback to ${checkpointId}: ${reason}`,
        timestamp: ts,
      },
    ],
  };
}

/**
 * List all checkpoints in the manifest.
 */
export function listCheckpoints(
  manifest: ProjectManifest,
): CheckpointEntry[] {
  return [...manifest.checkpoints];
}

/**
 * Get the latest checkpoint, or undefined if none exist.
 */
export function getLatestCheckpoint(
  manifest: ProjectManifest,
): CheckpointEntry | undefined {
  if (manifest.checkpoints.length === 0) return undefined;
  return manifest.checkpoints[manifest.checkpoints.length - 1];
}
