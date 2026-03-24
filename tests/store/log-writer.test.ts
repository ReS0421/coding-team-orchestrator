import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendEventLog,
  appendErrorLog,
  readNdjson,
} from "../../src/store/log-writer.js";
import type { ErrorLog } from "../../src/schemas/error-log.js";
import type { EventLogEntry } from "../../src/schemas/event-log.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, "tmp-"));
  return () => fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEvent(overrides?: Partial<EventLogEntry>): EventLogEntry {
  return {
    ts: new Date().toISOString(),
    event: "completed",
    ...overrides,
  } as EventLogEntry;
}

describe("appendEventLog", () => {
  it("appends event as NDJSON line", () => {
    const event = makeEvent({ session_id: "sess-1" });
    appendEventLog(event, { logDir: tmpDir });
    const lines = readNdjson(path.join(tmpDir, "events.ndjson"));
    expect(lines).toHaveLength(1);
    expect((lines[0] as Record<string, unknown>).event).toBe("completed");
    expect((lines[0] as Record<string, unknown>).session_id).toBe("sess-1");
  });

  it("appends multiple events", () => {
    appendEventLog(makeEvent({ event: "spawned" }), { logDir: tmpDir });
    appendEventLog(makeEvent({ event: "return_validated" }), { logDir: tmpDir });
    appendEventLog(makeEvent({ event: "completed" }), { logDir: tmpDir });
    const lines = readNdjson(path.join(tmpDir, "events.ndjson"));
    expect(lines).toHaveLength(3);
  });

  it("creates logDir if needed", () => {
    const nested = path.join(tmpDir, "deep", "logs");
    appendEventLog(makeEvent(), { logDir: nested });
    expect(fs.existsSync(path.join(nested, "events.ndjson"))).toBe(true);
  });
});

describe("appendErrorLog", () => {
  it("appends error entry", () => {
    const entry: ErrorLog = {
      session_id: "sess-1",
      role: "specialist",
      error_type: "crash",
      timestamp: new Date().toISOString(),
      dispatch_rev: 1,
      retry_count: 0,
      propagation_class: "contained",
      affected_tasks: ["task-1"],
      artifact_refs: [],
    };
    appendErrorLog(entry, { logDir: tmpDir });
    const lines = readNdjson(path.join(tmpDir, "errors.ndjson"));
    expect(lines).toHaveLength(1);
    expect((lines[0] as ErrorLog).session_id).toBe("sess-1");
  });
});

describe("readNdjson", () => {
  it("returns empty array for missing file", () => {
    expect(readNdjson(path.join(tmpDir, "nonexistent.ndjson"))).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "empty.ndjson"), "", "utf-8");
    expect(readNdjson(path.join(tmpDir, "empty.ndjson"))).toEqual([]);
  });
});
