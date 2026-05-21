const assert = require("node:assert/strict");
const test = require("node:test");
const { DccExClient } = require("../src/dcc-client");
const { layout } = require("../src/layout");
const { buildStopAllTrainCommands } = require("../src/railroad-commands");
const {
  buildTelemetrySummary,
  classifyTimestamp
} = require("../public/telemetry-health");

test("buildStopAllTrainCommands stops every configured train", () => {
  const state = {
    trains: {
      2: { direction: "reverse" },
      4: { direction: "forward" }
    }
  };

  assert.deepEqual(buildStopAllTrainCommands(layout, state), [
    "<t 1 0 1>",
    "<t 2 0 0>",
    "<t 4 0 1>",
    "<t 5 0 1>",
    "<t 6 0 1>",
    "<t 7 0 1>"
  ]);
});

test("mock client applies all-stop commands without changing reverse direction", async () => {
  const dcc = new DccExClient({
    host: "mock",
    port: 2560,
    mock: true,
    layout
  });

  dcc.start();
  await dcc.send("<t 2 45 0>");
  await dcc.send("<t 4 32 1>");

  for (const command of buildStopAllTrainCommands(layout, dcc.getState())) {
    await dcc.send(command);
  }

  assert.equal(dcc.getState().trains["2"].speed, 0);
  assert.equal(dcc.getState().trains["2"].direction, "reverse");
  assert.equal(dcc.getState().trains["4"].speed, 0);
  assert.equal(dcc.getState().trains["4"].direction, "forward");
});

test("classifyTimestamp labels fresh, stale, and missing telemetry", () => {
  const now = Date.parse("2026-05-21T13:00:00Z");

  assert.equal(classifyTimestamp("2026-05-21T12:59:30Z", now).status, "fresh");
  assert.equal(classifyTimestamp("2026-05-21T12:45:00Z", now).status, "stale");
  assert.equal(classifyTimestamp(null, now).status, "missing");
});

test("buildTelemetrySummary counts stale and missing layout entries", () => {
  const now = Date.parse("2026-05-21T13:00:00Z");
  const summary = buildTelemetrySummary(
    {
      sensors: {
        1001: { lastUpdated: "2026-05-21T12:59:58Z" }
      },
      turnouts: {},
      trains: {
        1: { lastUpdated: "2026-05-21T12:20:00Z" },
        2: { lastUpdated: "2026-05-21T12:59:00Z" }
      }
    },
    {
      sensors: [{ id: 1001, label: "S1" }],
      turnouts: [{ id: 1, label: "Main turnout" }],
      trains: [
        { address: 1, label: "Train 1" },
        { address: 2, label: "Train 2" }
      ]
    },
    now
  );

  assert.equal(summary.status, "alert");
  assert.equal(summary.label, "1 stale / 1 missing");
  assert.deepEqual(summary.details, [
    "Train 1: updated 40m ago",
    "Main turnout: no update"
  ]);
});
