const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const publicDir = path.join(__dirname, "..", "public");

test("control page includes action status feedback assets", async () => {
  const [html, script, firmwareView, styles] = await Promise.all([
    fs.readFile(path.join(publicDir, "index.html"), "utf8"),
    fs.readFile(path.join(publicDir, "app.js"), "utf8"),
    fs.readFile(path.join(publicDir, "firmware-status-view.js"), "utf8"),
    fs.readFile(path.join(publicDir, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="actionStatus"/);
  assert.match(html, /id="actionHistory"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Recent control actions"/);
  assert.match(script, /MAX_ACTION_HISTORY = 6/);
  assert.match(script, /function beginAction/);
  assert.match(script, /function completeAction/);
  assert.match(script, /function renderActionStatus/);
  assert.match(script, /function setActionStatus/);
  assert.match(script, /function actionSuccessMessage/);
  assert.match(styles, /\.action-status/);
  assert.match(styles, /\.action-history/);
  assert.match(html, /id="firmwareStatusPanel"/);
  assert.match(html, /id="firmwareRefreshButton"/);
  assert.match(html, /firmware-status-view\.js/);
  assert.match(script, /\/api\/firmware-status/);
  assert.match(script, /function renderFirmwareStatus/);
  assert.match(firmwareView, /function renderFirmwareStatusPanel/);
  assert.match(styles, /\.firmware-status/);
});
