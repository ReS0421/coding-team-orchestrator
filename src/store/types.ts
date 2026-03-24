import type {
  ArtifactFamily,
  ChangeClass,
  ControlState,
  Freshness,
  Lifecycle,
  SubmissionState,
} from "../domain/types.js";

// ─── ManifestArtifact ────────────────────────────────────
export interface ManifestArtifact {
  id: string;
  family: ArtifactFamily;
  path: string;
  content_rev: number;
  lifecycle?: Lifecycle;
  freshness?: Freshness;
  control_state?: ControlState;
  submission_state?: SubmissionState;
  depends_on?: string[];
  submitted_by?: string;
}

// ─── TransitionLogEntry ──────────────────────────────────
export interface TransitionLogEntry {
  artifact_id: string;
  from_content_rev: number;
  to_content_rev: number;
  manifest_seq_at: number;
  change_class: ChangeClass;
  reason: string;
  timestamp: string;
  invalidated?: Array<{
    artifact_id: string;
    freshness_change: string;
  }>;
}

// ─── CheckpointEntry ────────────────────────────────────
export interface CheckpointEntry {
  checkpoint_id: string; // cp-{seq}
  manifest_seq: number;
  timestamp: string;
  artifacts_snapshot: ManifestArtifact[];
}

// ─── ProjectManifest ────────────────────────────────────
export interface ProjectManifest {
  project: string;
  manifest_seq: number;
  artifacts: ManifestArtifact[];
  transitions: TransitionLogEntry[];
  checkpoints: CheckpointEntry[];
}

// ─── ArtifactFile ───────────────────────────────────────
export interface ArtifactFile {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

// ─── ManifestLite (Sprint 3 — Tier 2 shared) ───────────
// ManifestArtifact의 subset (control_state, submission_state, depends_on, submitted_by 제외)
export interface ManifestLiteArtifact {
  id: string;
  family: ArtifactFamily;      // reference | control only (no submission)
  path: string;
  content_rev: number;
  lifecycle?: Lifecycle;
  freshness?: Freshness;
}

export interface ManifestLite {
  manifest_lite_seq: number;
  brief_id: string;
  artifacts: ManifestLiteArtifact[];
  bootstrap_from?: string;       // "manifest-lite" when upgraded to full
}
