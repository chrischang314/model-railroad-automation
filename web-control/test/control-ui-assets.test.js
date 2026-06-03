const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const publicDir = path.join(__dirname, "..", "public");

test("control page includes action status feedback assets", async () => {
  const [html, script, operationsHtml, operationsScript, firmwareView, styles] = await Promise.all([
    fs.readFile(path.join(publicDir, "index.html"), "utf8"),
    fs.readFile(path.join(publicDir, "app.js"), "utf8"),
    fs.readFile(path.join(publicDir, "operations.html"), "utf8"),
    fs.readFile(path.join(publicDir, "operations.js"), "utf8"),
    fs.readFile(path.join(publicDir, "firmware-status-view.js"), "utf8"),
    fs.readFile(path.join(publicDir, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="actionStatus"/);
  assert.match(html, /id="actionHistory"/);
  assert.match(html, /id="sessionState"/);
  assert.match(html, /id="sessionSummary"/);
  assert.match(html, /id="sessionRefreshButton"/);
  assert.match(html, /id="sessionExportLink"/);
  assert.match(html, /id="sessionEventList"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Recent control actions"/);
  assert.match(html, /aria-label="Recent session events"/);
  assert.match(script, /MAX_ACTION_HISTORY = 6/);
  assert.match(script, /function beginAction/);
  assert.match(script, /function completeAction/);
  assert.match(script, /function renderActionStatus/);
  assert.match(script, /function setActionStatus/);
  assert.match(script, /function actionSuccessMessage/);
  assert.match(script, /function armHardware/);
  assert.match(script, /"X-CSRF-Token"/);
  assert.doesNotMatch(script, /Authorization/);
  assert.doesNotMatch(script, /localStorage\.setItem\("controlToken"/);
  assert.match(script, /function loadSessionPanel/);
  assert.match(script, /function renderSessionPanel/);
  assert.match(script, /apiGet\("\/api\/sessions\/latest"\)/);
  assert.doesNotMatch(script, /post\("\/api\/sessions/);
  assert.match(styles, /\.action-status/);
  assert.match(styles, /\.action-history/);
  assert.match(styles, /\.auth-controls/);
  assert.match(html, /id="authStatus"/);
  assert.match(html, /id="armButton"/);
  assert.match(html, /id="disarmButton"/);
  assert.match(operationsHtml, /id="authStatus"/);
  assert.match(operationsHtml, /id="armButton"/);
  assert.match(operationsHtml, /id="disarmButton"/);
  assert.match(operationsScript, /function armHardware/);
  assert.match(operationsScript, /"X-CSRF-Token"/);
  assert.doesNotMatch(operationsScript, /Authorization/);
  assert.doesNotMatch(operationsScript, /localStorage\.setItem\("controlToken"/);
  assert.match(html, /id="firmwareStatusPanel"/);
  assert.match(html, /id="firmwareRefreshButton"/);
  assert.match(html, /firmware-status-view\.js/);
  assert.match(script, /\/api\/firmware-status/);
  assert.match(script, /function renderFirmwareStatus/);
  assert.match(firmwareView, /function renderFirmwareStatusPanel/);
  assert.match(styles, /\.firmware-status/);
  assert.match(styles, /\.session-summary/);
  assert.match(styles, /\.session-events/);
});
