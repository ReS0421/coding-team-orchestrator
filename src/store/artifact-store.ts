import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { ArtifactFile } from "./types.js";

/**
 * Parse a file with YAML frontmatter (--- delimited) into ArtifactFile.
 */
export function parseFrontmatter(raw: string): ArtifactFile {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw, raw };
  }
  const frontmatter = (yaml.load(match[1]) as Record<string, unknown>) ?? {};
  const body = match[2];
  return { frontmatter, body, raw };
}

/**
 * Serialize frontmatter + body back into a raw string.
 */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const fm = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd();
  return `---\n${fm}\n---\n${body}`;
}

function resolvePath(projectRoot: string, artifactPath: string): string {
  return path.resolve(projectRoot, artifactPath);
}

/**
 * Read an artifact file and parse its frontmatter.
 */
export function readArtifact(
  projectRoot: string,
  artifactPath: string,
): ArtifactFile {
  const fullPath = resolvePath(projectRoot, artifactPath);
  const raw = fs.readFileSync(fullPath, "utf-8");
  return parseFrontmatter(raw);
}

/**
 * Write an artifact file, creating directories as needed.
 */
export function writeArtifact(
  projectRoot: string,
  artifactPath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const fullPath = resolvePath(projectRoot, artifactPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, serializeFrontmatter(frontmatter, body), "utf-8");
}

/**
 * Check if an artifact file exists.
 */
export function artifactExists(
  projectRoot: string,
  artifactPath: string,
): boolean {
  return fs.existsSync(resolvePath(projectRoot, artifactPath));
}

/**
 * Delete an artifact file.
 */
export function deleteArtifact(
  projectRoot: string,
  artifactPath: string,
): void {
  const fullPath = resolvePath(projectRoot, artifactPath);
  fs.unlinkSync(fullPath);
}

// ─── Brief thin wrappers ────────────────────────────────

import type { Brief } from "../schemas/brief.js";
import { validateBrief } from "../schemas/brief.js";

const BRIEF_PATH = "artifacts/brief.yaml";

/**
 * Save a Brief to artifacts/brief.yaml.
 */
export function saveBrief(projectRoot: string, brief: Brief): void {
  const { brief_id, goal, ...rest } = brief;
  writeArtifact(projectRoot, BRIEF_PATH, { brief_id, goal }, yaml.dump(rest, { lineWidth: -1 }));
}

/**
 * Load and validate a Brief from artifacts/brief.yaml.
 */
export function loadBrief(projectRoot: string): Brief {
  const artifact = readArtifact(projectRoot, BRIEF_PATH);
  const data = {
    ...artifact.frontmatter,
    ...yaml.load(artifact.body) as Record<string, unknown>,
  };
  return validateBrief(data);
}
