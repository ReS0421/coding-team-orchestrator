import { describe, it, expect } from "vitest";
import {
  createHeartbeatState,
  recordHeartbeat,
  checkHeartbeat,
  diagnoseLeadStatus,
  type HeartbeatConfig,
} from "../../src/engine/heartbeat.js";

const config: HeartbeatConfig = {
  interval_ms: 1000,       // alive if elapsed < 1s
  stale_threshold_ms: 3000, // dead if elapsed >= 3s
};

describe("createHeartbeatState", () => {
  it("creates state with alive status", () => {
    const now = Date.now();
    const state = createHeartbeatState(now);
    expect(state.status).toBe("alive");
    expect(state.last_heartbeat).toBe(now);
  });
});

describe("recordHeartbeat", () => {
  it("records new heartbeat and sets status to alive", () => {
    const old = { last_heartbeat: 0, status: "stale" as const };
    const now = Date.now();
    const state = recordHeartbeat(old, now);
    expect(state.status).toBe("alive");
    expect(state.last_heartbeat).toBe(now);
  });
});

describe("checkHeartbeat", () => {
  it("alive when elapsed < interval_ms", () => {
    const now = 1000000;
    const state = createHeartbeatState(now);
    const result = checkHeartbeat(state, config, now + 500); // 500ms elapsed
    expect(result.status).toBe("alive");
  });

  it("stale when interval_ms <= elapsed < stale_threshold_ms", () => {
    const now = 1000000;
    const state = createHeartbeatState(now);
    const result = checkHeartbeat(state, config, now + 1500); // 1500ms elapsed
    expect(result.status).toBe("stale");
  });

  it("dead when elapsed >= stale_threshold_ms", () => {
    const now = 1000000;
    const state = createHeartbeatState(now);
    const result = checkHeartbeat(state, config, now + 5000); // 5000ms elapsed
    expect(result.status).toBe("dead");
  });
});

describe("diagnoseLeadStatus", () => {
  it("healthy when alive and session alive", () => {
    const hb = { last_heartbeat: Date.now(), status: "alive" as const };
    expect(diagnoseLeadStatus(hb, true)).toBe("healthy");
  });

  it("stalled when heartbeat is stale", () => {
    const hb = { last_heartbeat: 0, status: "stale" as const };
    expect(diagnoseLeadStatus(hb, true)).toBe("stalled");
  });

  it("crash when heartbeat is dead", () => {
    const hb = { last_heartbeat: 0, status: "dead" as const };
    expect(diagnoseLeadStatus(hb, true)).toBe("crash");
  });

  it("crash when session not alive", () => {
    const hb = { last_heartbeat: Date.now(), status: "alive" as const };
    expect(diagnoseLeadStatus(hb, false)).toBe("crash");
  });
});
