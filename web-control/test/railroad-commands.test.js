const assert = require("node:assert/strict");
const test = require("node:test");
const { DccExClient } = require("../src/dcc-client");
const { layout } = require("../src/layout");
const { buildStopAllTrainCommands } = require("../src/railroad-commands");

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
