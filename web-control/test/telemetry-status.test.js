const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildTelemetryStatus,
  formatDuration,
  telemetryPillClass
} = require("../public/telemetry-status");

test("fresh telemetry reports the last CSB1 message age", () => {
  const status = buildTelemetryStatus({
    connected: true,
    lastMessageAt: "2026-05-21T13:00:00.000Z"
  }, {
    nowMs: Date.parse("2026-05-21T13:00:05.000Z"),
    staleAfterMs: 15000
  });

  assert.equal(status.state, "fresh");
  assert.equal(status.stale, false);
  assert.equal(status.lastMessageAgeMs, 5000);
  assert.equal(status.detail, "Last CSB1 message 5s ago");
  assert.equal(telemetryPillClass(status), "running");
});

test("stale telemetry reports an actionable warning state", () => {
  const status = buildTelemetryStatus({
    connected: true,
    lastMessageAt: "2026-05-21T13:00:00.000Z"
  }, {
    nowMs: Date.parse("2026-05-21T13:00:20.000Z"),
    staleAfterMs: 15000
  });

  assert.equal(status.state, "stale");
  assert.equal(status.stale, true);
  assert.equal(status.detail, "Last CSB1 message 20s ago");
  assert.equal(telemetryPillClass(status), "error");
});

test("connected stations without a first message show waiting before the stale window", () => {
  const status = buildTelemetryStatus({
    connected: true,
    lastConnectedAt: "2026-05-21T13:00:00.000Z",
    lastMessageAt: null
  }, {
    nowMs: Date.parse("2026-05-21T13:00:05.000Z"),
    staleAfterMs: 15000
  });

  assert.equal(status.state, "waiting");
  assert.equal(status.stale, false);
  assert.equal(status.detail, "Waiting for first CSB1 message");
  assert.equal(telemetryPillClass(status), "alert");
});

test("disconnected stations surface the connection problem", () => {
  const status = buildTelemetryStatus({
    connected: false,
    lastError: "connection refused"
  });

  assert.equal(status.state, "disconnected");
  assert.equal(status.stale, true);
  assert.equal(status.detail, "connection refused");
  assert.equal(telemetryPillClass(status), "error");
});

test("formatDuration keeps telemetry copy compact", () => {
  assert.equal(formatDuration(250), "less than 1s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(90_000), "2m");
  assert.equal(formatDuration(7_200_000), "2h");
});
