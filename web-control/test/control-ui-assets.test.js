const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const publicDir = path.join(__dirname, "..", "public");

test("control page includes action status feedback assets", async () => {
  const [html, script, styles] = await Promise.all([
    fs.readFile(path.join(publicDir, "index.html"), "utf8"),
    fs.readFile(path.join(publicDir, "app.js"), "utf8"),
    fs.readFile(path.join(publicDir, "styles.css"), "utf8")
  ]);

  assert.match(html, /id="actionStatus"/);
  assert.match(html, /role="status"/);
  assert.match(script, /function setActionStatus/);
  assert.match(script, /function actionSuccessMessage/);
  assert.match(styles, /\.action-status/);
});
