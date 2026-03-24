import * as fs from "node:fs";
import * as path from "node:path";
import type { ErrorLog } from "../schemas/error-log.js";
import type { EventLogEntry } from "../schemas/event-log.js";

const EVENT_LOG_FILE = "events.ndjson";
const ERROR_LOG_FILE = "errors.ndjson";

/**
 * Append an event to the NDJSON event log.
 */
export function appendEventLog(
  event: EventLogEntry,
  options: { logDir: string },
): void {
  const filePath = path.resolve(options.logDir, EVENT_LOG_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf-8");
}

/**
 * Append an error entry to the NDJSON error log.
 */
export function appendErrorLog(
  entry: ErrorLog,
  options: { logDir: string },
): void {
  const filePath = path.resolve(options.logDir, ERROR_LOG_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read an NDJSON file and return parsed entries.
 */
export function readNdjson<T = Record<string, unknown>>(
  filePath: string,
): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}
