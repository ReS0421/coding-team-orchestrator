import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type {
  ManifestLite,
  ManifestLiteArtifact,
  ProjectManifest,
  ManifestArtifact,
} from "./types.js";

const MANIFEST_LITE_FILE = "artifacts/manifest-lite.yaml";

/**
 * Create an empty manifest-lite for a brief.
 */
export function createEmptyManifestLite(briefId: string): ManifestLite {
  return {
    manifest_lite_seq: 0,
    brief_id: briefId,
    artifacts: [],
  };
}

/**
 * Load a manifest-lite from YAML.
 */
export function loadManifestLite(projectRoot: string): ManifestLite {
  const fullPath = path.resolve(projectRoot, MANIFEST_LITE_FILE);
  const raw = fs.readFileSync(fullPath, "utf-8");
  const data = yaml.load(raw) as ManifestLite;
  return {
    manifest_lite_seq: data.manifest_lite_seq,
    brief_id: data.brief_id,
    artifacts: data.artifacts ?? [],
    bootstrap_from: data.bootstrap_from,
  };
}

/**
 * Save a manifest-lite to YAML.
 */
export function saveManifestLite(
  projectRoot: string,
  manifest: ManifestLite,
): void {
  const fullPath = path.resolve(projectRoot, MANIFEST_LITE_FILE);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = yaml.dump(manifest, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Add an artifact to the manifest-lite and increment seq.
 */
export function addManifestLiteArtifact(
  manifest: ManifestLite,
  artifact: ManifestLiteArtifact,
): ManifestLite {
  return {
    ...manifest,
    manifest_lite_seq: manifest.manifest_lite_seq + 1,
    artifacts: [...manifest.artifacts, artifact],
  };
}

/**
 * Upgrade a manifest-lite to a full ProjectManifest.
 * Used when Tier 2 → Tier 3 escalation occurs.
 */
export function upgradeToFullManifest(lite: ManifestLite): ProjectManifest {
  const artifacts: ManifestArtifact[] = lite.artifacts.map((a) => ({
    id: a.id,
    family: a.family,
    path: a.path,
    content_rev: a.content_rev,
    lifecycle: a.lifecycle,
    freshness: a.freshness,
  }));

  return {
    project: lite.brief_id,
    manifest_seq: lite.manifest_lite_seq,
    artifacts,
    transitions: [],
    checkpoints: [],
  };
}
