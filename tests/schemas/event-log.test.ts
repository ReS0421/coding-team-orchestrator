import { describe, it, expect } from "vitest";
import {
  validateEventLogEntry,
  safeValidateEventLogEntry,
} from "../../src/schemas/event-log.js";

const validEntry = {
  ts: "2026-03-24T10:00:00.000Z",
  event: "completed" as const,
};

describe("EventLogEntry - valid", () => {
  it("parses minimal valid entry", () => {
    const result = validateEventLogEntry(validEntry);
    expect(result.event).toBe("completed");
    expect(result.ts).toBe("2026-03-24T10:00:00.000Z");
  });

  it("parses with optional fields", () => {
    const result = validateEventLogEntry({
      ...validEntry,
      session_id: "sess-1",
      role: "specialist",
      dispatch_rev: 3,
    });
    expect(result.session_id).toBe("sess-1");
    expect(result.role).toBe("specialist");
    expect(result.dispatch_rev).toBe(3);
  });

  it("allows passthrough fields", () => {
    const result = validateEventLogEntry({
      ...validEntry,
      task: "some task",
      custom_data: { foo: "bar" },
    });
    expect((result as Record<string, unknown>).task).toBe("some task");
  });

  it("parses all event types", () => {
    const types = [
      "spawned", "return_validated", "patch_committed",
      "checkpoint_created", "error", "completed",
      "owner_spawn", "owner_commit", "consumer_blocked",
      "shared_redispatch", "tier3_escalation", "acting_lead_assigned",
    ];
    types.forEach((t) =>
      expect(() => validateEventLogEntry({ ...validEntry, event: t })).not.toThrow()
    );
  });
});

describe("EventLogEntry - invalid", () => {
  it("rejects missing ts", () => {
    expect(() => validateEventLogEntry({ event: "completed" })).toThrow();
  });

  it("rejects missing event", () => {
    expect(() => validateEventLogEntry({ ts: "2026-03-24T10:00:00.000Z" })).toThrow();
  });

  it("rejects invalid event type", () => {
    expect(() => validateEventLogEntry({ ...validEntry, event: "unknown_event" })).toThrow();
  });

  it("rejects invalid ts format", () => {
    expect(() => validateEventLogEntry({ ...validEntry, ts: "not-a-date" })).toThrow();
  });

  it("safeValidate returns success=false for invalid", () => {
    const result = safeValidateEventLogEntry({ event: "bad" });
    expect(result.success).toBe(false);
  });
});
