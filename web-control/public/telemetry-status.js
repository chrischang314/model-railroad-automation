(function publishTelemetryStatus(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TelemetryStatus = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTelemetryStatus() {
  const DEFAULT_STALE_AFTER_MS = 15000;

  function buildTelemetryStatus(connection, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const staleAfterMs = Number.isFinite(options.staleAfterMs)
      ? options.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;

    if (!connection?.connected) {
      return {
        state: "disconnected",
        label: "Disconnected",
        detail: connection?.lastError || "No live CSB1 connection",
        lastMessageAgeMs: null,
        staleAfterMs,
        stale: true
      };
    }

    const lastMessageMs = parseTimestamp(connection.lastMessageAt);
    const lastConnectedMs = parseTimestamp(connection.lastConnectedAt);

    if (lastMessageMs === null) {
      const connectedAgeMs = lastConnectedMs === null ? null : Math.max(0, nowMs - lastConnectedMs);
      const stale = connectedAgeMs === null || connectedAgeMs > staleAfterMs;
      return {
        state: stale ? "stale" : "waiting",
        label: stale ? "Telemetry stale" : "Waiting",
        detail: stale ? "No CSB1 messages received yet" : "Waiting for first CSB1 message",
        lastMessageAgeMs: null,
        staleAfterMs,
        stale
      };
    }

    const lastMessageAgeMs = Math.max(0, nowMs - lastMessageMs);
    const stale = lastMessageAgeMs > staleAfterMs;
    return {
      state: stale ? "stale" : "fresh",
      label: stale ? "Telemetry stale" : "Telemetry fresh",
      detail: `Last CSB1 message ${formatDuration(lastMessageAgeMs)} ago`,
      lastMessageAgeMs,
      staleAfterMs,
      stale
    };
  }

  function telemetryPillClass(status) {
    if (status.state === "fresh") return "running";
    if (status.state === "waiting") return "alert";
    return "error";
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return "unknown";
    if (ms < 1000) return "less than 1s";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }

  function parseTimestamp(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  return {
    DEFAULT_STALE_AFTER_MS,
    buildTelemetryStatus,
    telemetryPillClass,
    formatDuration
  };
});
