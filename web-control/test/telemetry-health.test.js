const assert = require("node:assert/strict");
const test = require("node:test");
const { buildHealthPayload, buildTelemetrySummary } = require("../src/telemetry-health");

const now = new Date("2026-05-21T13:30:00.000Z");

test("health payload reports disconnected command station without marking telemetry stale", () => {
  const payload = buildHealthPayload({
    connection: { connected: false, mock: false, lastMessageAt: null },
    messages: []
  }, { now });

  assert.equal(payload.ok, false);
  assert.equal(payload.telemetry.stale, false);
  assert.equal(payload.telemetry.ageSeconds, null);
});

test("connected real command station with no messages is stale", () => {
  const summary = buildTelemetrySummary({
    connection: { connected: true, mock: false, lastMessageAt: null },
    messages: []
  }, { now });

  assert.equal(summary.stale, true);
  assert.equal(summary.lastMessageAt, null);
});

test("recent telemetry keeps health ok and includes operational counts", () => {
  const payload = buildHealthPayload({
    connection: {
      connected: true,
      mock: false,
      lastMessageAt: "2026-05-21T13:29:52.000Z"
    },
    power: { state: "on" },
    automation: { running: true, stopRequested: false },
    trains: {
      2: { address: 2, label: "Train 2", speed: 20, direction: "forward" },
      4: { address: 4, label: "Train 4", speed: 0, direction: "reverse" }
    },
    sensors: {
      1001: { id: 1001, label: "S1", vpin: 33, active: true },
      1002: { id: 1002, label: "S2", vpin: 26, active: false }
    },
    messages: [{ message: "<Q 1001>" }]
  }, { now, staleAfterMs: 15000 });

  assert.equal(payload.ok, true);
  assert.equal(payload.telemetry.stale, false);
  assert.equal(payload.telemetry.ageSeconds, 8);
  assert.deepEqual(payload.movingTrains, [
    { address: 2, label: "Train 2", speed: 20, direction: "forward" }
  ]);
  assert.deepEqual(payload.activeSensors, [
    { id: 1001, label: "S1", vpin: 33 }
  ]);
});

test("old real telemetry marks health not ok", () => {
  const payload = buildHealthPayload({
    connection: {
      connected: true,
      mock: false,
      lastMessageAt: "2026-05-21T13:29:20.000Z"
    },
    messages: []
  }, { now, staleAfterMs: 15000 });

  assert.equal(payload.ok, false);
  assert.equal(payload.telemetry.stale, true);
  assert.equal(payload.telemetry.ageSeconds, 40);
});

test("mock command station is not stale without incoming hardware messages", () => {
  const payload = buildHealthPayload({
    connection: { connected: true, mock: true, lastMessageAt: null },
    messages: []
  }, { now });

  assert.equal(payload.ok, true);
  assert.equal(payload.telemetry.stale, false);
});
