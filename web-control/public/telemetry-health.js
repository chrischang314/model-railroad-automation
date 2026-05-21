(function attachTelemetryHealth(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TelemetryHealth = api;
})(typeof window !== "undefined" ? window : globalThis, function createTelemetryHealth() {
  const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

  function classifyTimestamp(timestamp, now = Date.now(), options = {}) {
    const staleAfterMs = Number.isFinite(options.staleAfterMs)
      ? options.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;
    const nowMs = toMillis(now);
    const updatedMs = toMillis(timestamp);

    if (!Number.isFinite(updatedMs)) {
      return {
        status: "missing",
        pillClass: "unknown",
        label: "no update",
        ageMs: null,
        stale: false
      };
    }

    const ageMs = Math.max(0, nowMs - updatedMs);
    const stale = ageMs > staleAfterMs;
    return {
      status: stale ? "stale" : "fresh",
      pillClass: stale ? "alert" : "fresh",
      label: `updated ${formatDuration(ageMs)}`,
      ageMs,
      stale
    };
  }

  function buildTelemetrySummary(state, layout, now = Date.now(), options = {}) {
    const entries = collectTelemetryEntries(state, layout, now, options);
    const stale = entries.filter((entry) => entry.telemetry.status === "stale");
    const missing = entries.filter((entry) => entry.telemetry.status === "missing");

    if (stale.length || missing.length) {
      return {
        status: stale.length ? "alert" : "unknown",
        label: [
          stale.length ? `${stale.length} stale` : "",
          missing.length ? `${missing.length} missing` : ""
        ].filter(Boolean).join(" / "),
        entries,
        details: [...stale, ...missing].map((entry) => `${entry.label}: ${entry.telemetry.label}`)
      };
    }

    return {
      status: "fresh",
      label: "Telemetry fresh",
      entries,
      details: []
    };
  }

  function collectTelemetryEntries(state, layout, now = Date.now(), options = {}) {
    const entries = [];
    const safeState = state || {};
    const safeLayout = layout || {};

    for (const sensor of safeLayout.sensors || []) {
      const live = safeState.sensors?.[String(sensor.id)];
      entries.push(buildEntry("sensor", sensor.label || `Sensor ${sensor.id}`, live?.lastUpdated, now, options));
    }

    for (const turnout of safeLayout.turnouts || []) {
      const live = safeState.turnouts?.[String(turnout.id)];
      entries.push(buildEntry("turnout", turnout.label || `Turnout ${turnout.id}`, live?.lastUpdated, now, options));
    }

    for (const train of safeLayout.trains || []) {
      const live = safeState.trains?.[String(train.address)];
      entries.push(buildEntry("train", train.label || `Train ${train.address}`, live?.lastUpdated, now, options));
    }

    return entries;
  }

  function buildEntry(type, label, timestamp, now, options) {
    return {
      type,
      label,
      telemetry: classifyTimestamp(timestamp, now, options)
    };
  }

  function formatDuration(ageMs) {
    const seconds = Math.round(ageMs / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;

    return `${Math.round(hours / 24)}d ago`;
  }

  function toMillis(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) return Date.parse(value);
    return Number.NaN;
  }

  return {
    DEFAULT_STALE_AFTER_MS,
    buildTelemetrySummary,
    classifyTimestamp,
    collectTelemetryEntries,
    formatDuration
  };
});
