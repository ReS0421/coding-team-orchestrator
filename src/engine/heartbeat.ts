export interface HeartbeatConfig {
  interval_ms: number;
  stale_threshold_ms: number;
}

export interface HeartbeatState {
  last_heartbeat: number;
  status: "alive" | "stale" | "dead";
}

/**
 * Create initial heartbeat state.
 * @param now Optional timestamp override (default: Date.now())
 */
export function createHeartbeatState(now?: number): HeartbeatState {
  return {
    last_heartbeat: now ?? Date.now(),
    status: "alive",
  };
}

/**
 * Record a new heartbeat (lead is alive).
 */
export function recordHeartbeat(state: HeartbeatState, now?: number): HeartbeatState {
  return {
    last_heartbeat: now ?? Date.now(),
    status: "alive",
  };
}

/**
 * Check heartbeat status based on elapsed time.
 * - alive: elapsed < interval_ms
 * - stale: interval_ms <= elapsed < stale_threshold_ms
 * - dead: elapsed >= stale_threshold_ms
 */
export function checkHeartbeat(
  state: HeartbeatState,
  config: HeartbeatConfig,
  now?: number,
): HeartbeatState {
  const current = now ?? Date.now();
  const elapsed = current - state.last_heartbeat;

  let status: HeartbeatState["status"];
  if (elapsed < config.interval_ms) {
    status = "alive";
  } else if (elapsed < config.stale_threshold_ms) {
    status = "stale";
  } else {
    status = "dead";
  }

  return { ...state, status };
}

/**
 * Diagnose lead status based on heartbeat and session liveness.
 * - healthy: alive heartbeat + session alive
 * - stalled: stale heartbeat
 * - crash: dead heartbeat OR session not alive
 */
export function diagnoseLeadStatus(
  heartbeat: HeartbeatState,
  sessionAlive: boolean,
): "healthy" | "stalled" | "crash" {
  if (!sessionAlive || heartbeat.status === "dead") {
    return "crash";
  }
  if (heartbeat.status === "stale") {
    return "stalled";
  }
  return "healthy";
}
