const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readFirmwareStatus } = require("../src/firmware-status");

const now = new Date("2026-05-29T13:00:00.000Z");

test("firmware status reads a valid updater artifact", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-firmware-status-"));
  const statusFile = path.join(tempDir, "firmware-status.json");
  await fs.writeFile(statusFile, JSON.stringify(sampleStatus({
    generatedAt: "2026-05-29T12:59:00.000Z",
    decision: "success"
  })));

  const payload = await readFirmwareStatus(statusFile, { now, staleAfterMs: 30 * 60 * 1000 });

  assert.equal(payload.ok, true);
  assert.equal(payload.state, "current");
  assert.equal(payload.automation.version, "v3.18.0");
  assert.equal(payload.automation.trackedHash, "abc123def456");
  assert.equal(payload.flash.decision, "success");
});

test("firmware status reports missing, malformed, stale, and failed artifacts as warnings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-firmware-warnings-"));
  const missing = await readFirmwareStatus(path.join(tempDir, "missing.json"), { now });
  assert.equal(missing.ok, false);
  assert.match(missing.warning, /missing/);

  const malformedPath = path.join(tempDir, "malformed.json");
  await fs.writeFile(malformedPath, "{nope");
  const malformed = await readFirmwareStatus(malformedPath, { now });
  assert.equal(malformed.ok, false);
  assert.match(malformed.warning, /malformed/);

  const stalePath = path.join(tempDir, "stale.json");
  await fs.writeFile(stalePath, JSON.stringify(sampleStatus({
    generatedAt: "2026-05-29T11:00:00.000Z",
    decision: "unchanged-no-flash"
  })));
  const stale = await readFirmwareStatus(stalePath, { now, staleAfterMs: 30 * 60 * 1000 });
  assert.equal(stale.ok, false);
  assert.match(stale.warning, /stale/);

  const failedPath = path.join(tempDir, "failed.json");
  await fs.writeFile(failedPath, JSON.stringify({
    ...sampleStatus({ generatedAt: "2026-05-29T12:59:00.000Z", decision: "failure" }),
    status: "failed",
    error: "compile failed"
  }));
  const failed = await readFirmwareStatus(failedPath, { now, staleAfterMs: 30 * 60 * 1000 });
  assert.equal(failed.ok, false);
  assert.match(failed.warning, /failed/);
});

test("firmware status endpoint stays public when control token is enabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-firmware-endpoint-"));
  const statusFile = path.join(tempDir, "firmware-status.json");
  await fs.writeFile(statusFile, JSON.stringify(sampleStatus({
    generatedAt: new Date().toISOString(),
    decision: "baseline-recorded"
  })));
  const port = await freePort();
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      CONTROL_TOKEN: "required-token",
      DCCEX_MOCK: "true",
      FIRMWARE_STATUS_FILE: statusFile,
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForJson(`http://127.0.0.1:${port}/health`);
    const response = await fetch(`http://127.0.0.1:${port}/api/firmware-status`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.flash.decision, "baseline-recorded");
  } finally {
    server.kill();
  }
});

function sampleStatus({ generatedAt, decision }) {
  return {
    schemaVersion: 1,
    generatedAt,
    status: decision === "failure" ? "failed" : "current",
    source: "ota-updater",
    modelRepo: { ref: "main", branch: "main", commit: "model-commit" },
    commandStation: { ref: "v5.6.0-Prod", commit: "dcc-commit" },
    automation: {
      file: "dcc-ex/myAutomation.h",
      configFile: "dcc-ex/config.csb1.h",
      trackedHash: "abc123def456",
      version: "v3.18.0"
    },
    flash: {
      decision,
      currentHash: "abc123def456",
      previousHash: "old",
      forceFlash: false,
      autoFlash: true,
      attempted: decision === "success",
      flashedAt: decision === "success" ? generatedAt : null,
      baselineRecordedAt: decision === "baseline-recorded" ? generatedAt : null,
      target: { devicePort: "/dev/csb1", dccExHost: "192.168.4.22", dccExPort: 2560 }
    },
    sensorSetup: { attempted: false, result: "not-run", skippedReason: null, error: null },
    error: null
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}
