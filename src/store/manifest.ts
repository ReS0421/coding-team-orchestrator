import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ManifestArtifact, ProjectManifest } from "./types.js";

const MANIFEST_FILE = "project-manifest.yaml";

/**
 * Create an empty manifest for a project.
 */
export function createEmptyManifest(project: string): ProjectManifest {
  return {
    project,
    manifest_seq: 0,
    artifacts: [],
    transitions: [],
    checkpoints: [],
  };
}

/**
 * Load a manifest from a YAML file.
 */
export function loadManifest(projectRoot: string): ProjectManifest {
  const fullPath = path.resolve(projectRoot, MANIFEST_FILE);
  const raw = fs.readFileSync(fullPath, "utf-8");
  const data = yaml.load(raw) as ProjectManifest;
  return {
    project: data.project,
    manifest_seq: data.manifest_seq,
    artifacts: data.artifacts ?? [],
    transitions: data.transitions ?? [],
    checkpoints: data.checkpoints ?? [],
  };
}

/**
 * Save a manifest to a YAML file.
 */
export function saveManifest(
  projectRoot: string,
  manifest: ProjectManifest,
): void {
  const fullPath = path.resolve(projectRoot, MANIFEST_FILE);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = yaml.dump(manifest, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Find an artifact by id. Returns undefined if not found.
 */
export function findArtifact(
  manifest: ProjectManifest,
  artifactId: string,
): ManifestArtifact | undefined {
  return manifest.artifacts.find((a) => a.id === artifactId);
}

/**
 * Add an artifact to the manifest (immutable). Throws if id already exists.
 */
export function addArtifact(
  manifest: ProjectManifest,
  artifact: ManifestArtifact,
): ProjectManifest {
  if (manifest.artifacts.some((a) => a.id === artifact.id)) {
    throw new Error(`Artifact '${artifact.id}' already exists in manifest`);
  }
  return {
    ...manifest,
    artifacts: [...manifest.artifacts, artifact],
  };
}

/**
 * Update an artifact in the manifest (immutable). Throws if id not found.
 */
export function updateArtifact(
  manifest: ProjectManifest,
  artifactId: string,
  updates: Partial<ManifestArtifact>,
): ProjectManifest {
  const idx = manifest.artifacts.findIndex((a) => a.id === artifactId);
  if (idx === -1) {
    throw new Error(`Artifact '${artifactId}' not found in manifest`);
  }
  const newArtifacts = [...manifest.artifacts];
  newArtifacts[idx] = { ...newArtifacts[idx], ...updates };
  return { ...manifest, artifacts: newArtifacts };
}

/**
 * List all artifacts, optionally filtered by family.
 */
export function listArtifacts(
  manifest: ProjectManifest,
  family?: string,
): ManifestArtifact[] {
  if (!family) return [...manifest.artifacts];
  return manifest.artifacts.filter((a) => a.family === family);
}
