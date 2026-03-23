import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendEventLog,
  appendErrorLog,
  readNdjson,
} from "../../src/store/log-writer.js";
import type { ErrorLog } from "../../src/schemas/error-log.js";

describe("log-writer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-writer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("appendEventLog", () => {
    it("appends event as NDJSON line", () => {
      appendEventLog({ type: "test", data: 42 }, { logDir: tmpDir });
      const lines = readNdjson(path.join(tmpDir, "events.ndjson"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({ type: "test", data: 42 });
    });

    it("appends multiple events", () => {
      appendEventLog({ seq: 1 }, { logDir: tmpDir });
      appendEventLog({ seq: 2 }, { logDir: tmpDir });
      appendEventLog({ seq: 3 }, { logDir: tmpDir });
      const lines = readNdjson(path.join(tmpDir, "events.ndjson"));
      expect(lines).toHaveLength(3);
    });

    it("creates logDir if needed", () => {
      const nested = path.join(tmpDir, "deep", "logs");
      appendEventLog({ ok: true }, { logDir: nested });
      expect(fs.existsSync(path.join(nested, "events.ndjson"))).toBe(true);
    });
  });

  describe("appendErrorLog", () => {
    it("appends error as NDJSON line", () => {
      const entry: ErrorLog = {
        session_id: "sess-1",
        role: "specialist",
        error_type: "timeout",
        timestamp: "2026-03-21T14:00:00Z",
        dispatch_rev: 1,
        retry_count: 0,
        propagation_class: "contained",
        affected_tasks: ["task-1"],
        artifact_refs: ["spec"],
      };
      appendErrorLog(entry, { logDir: tmpDir });
      const lines = readNdjson(path.join(tmpDir, "errors.ndjson"));
      expect(lines).toHaveLength(1);
      expect((lines[0] as ErrorLog).session_id).toBe("sess-1");
    });
  });

  describe("readNdjson", () => {
    it("returns empty array for missing file", () => {
      expect(readNdjson(path.join(tmpDir, "missing.ndjson"))).toEqual([]);
    });

    it("returns empty array for empty file", () => {
      fs.writeFileSync(path.join(tmpDir, "empty.ndjson"), "");
      expect(readNdjson(path.join(tmpDir, "empty.ndjson"))).toEqual([]);
    });

    it("parses multiple JSON lines", () => {
      const filePath = path.join(tmpDir, "multi.ndjson");
      fs.writeFileSync(filePath, '{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = readNdjson(filePath);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ a: 1 });
      expect(result[2]).toEqual({ c: 3 });
    });
  });
});
