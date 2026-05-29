const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { buildFirmwareStatusView, renderFirmwareStatusPanel } = require("../public/firmware-status-view");

const webRoot = path.join(__dirname, "..");

test("firmware status endpoint returns a valid read-only status without auth", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-firmware-status-"));
  const statusFile = path.join(tempDir, "firmware-status.json");
  await fs.writeFile(statusFile, JSON.stringify(statusFixture(), null, 2), "utf8");

  await withServer({ FIRMWARE_STATUS_FILE: statusFile, CONTROL_TOKEN: "test-token" }, async (baseUrl) => {
    const before = await getJson(`${baseUrl}/api/state`);
    const response = await fetch(`${baseUrl}/api/firmware-status`);
    const payload = await response.json();
    const after = await getJson(`${baseUrl}/api/state`);

    assert.equal(response.status, 200);
    assert.equal(payload.state, "current");
    assert.equal(payload.artifact.automation.version, "v3.18.0");
    assert.equal(payload.artifact.trackedHash, "abc123abc123abc123");
    assert.equal(after.messages.length, before.messages.length);
  });
});

test("firmware status endpoint reports missing, malformed, and stale files as non-500 warnings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-firmware-status-"));
  const missing = path.join(tempDir, "missing.json");
  const malformed = path.join(tempDir, "malformed.json");
  const stale = path.join(tempDir, "stale.json");
  await fs.writeFile(malformed, "{not-json", "utf8");
  await fs.writeFile(stale, JSON.stringify(statusFixture({
    recordedAt: "2026-05-01T00:00:00Z"
  }), null, 2), "utf8");

  await withServer({ FIRMWARE_STATUS_FILE: missing }, async (baseUrl) => {
    const payload = await getJson(`${baseUrl}/api/firmware-status`);
    assert.equal(payload.state, "missing");
  });

  await withServer({ FIRMWARE_STATUS_FILE: malformed }, async (baseUrl) => {
    const payload = await getJson(`${baseUrl}/api/firmware-status`);
    assert.equal(payload.state, "malformed");
  });

  await withServer({ FIRMWARE_STATUS_FILE: stale, FIRMWARE_STATUS_STALE_MS: "1" }, async (baseUrl) => {
    const payload = await getJson(`${baseUrl}/api/firmware-status`);
    assert.equal(payload.state, "stale");
  });
});

test("firmware panel view renders current, missing, and warning states", () => {
  const current = buildFirmwareStatusView({
    state: "current",
    message: "Firmware status is current.",
    artifact: statusFixture()
  }, "iDCC-EX V-5.6.0");
  assert.equal(current.title, "Firmware Proof Current");
  assert.equal(current.rows[0].value, "iDCC-EX V-5.6.0");
  assert.equal(current.rows[1].value, "v3.18.0");

  const missingContainer = { className: "", innerHTML: "" };
  renderFirmwareStatusPanel(missingContainer, {
    state: "missing",
    message: "No updater status artifact has been recorded yet.",
    artifact: null
  }, null);
  assert.match(missingContainer.className, /missing/);
  assert.match(missingContainer.innerHTML, /Firmware Proof Needs Attention/);

  const warningContainer = { className: "", innerHTML: "" };
  renderFirmwareStatusPanel(warningContainer, {
    state: "stale",
    message: "Firmware status proof is older than the configured freshness window.",
    artifact: statusFixture({ status: "warning" })
  }, null);
  assert.match(warningContainer.className, /stale/);
  assert.match(warningContainer.innerHTML, /stale/);
});

function statusFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "current",
    decision: "success",
    message: "Flash completed.",
    recordedAt: new Date().toISOString(),
    flashedAt: new Date().toISOString(),
    baselineAt: null,
    trackedHash: "abc123abc123abc123",
    previousHash: "def456def456",
    automation: {
      file: "dcc-ex/myAutomation.h",
      version: "v3.18.0",
      hash: "abc123abc123abc123"
    },
    config: {
      file: "dcc-ex/config.csb1.h",
      hash: "def456def456def456"
    },
    modelRepo: {
      ref: "main",
      checkedOutRef: "main",
      commit: "0123456789abcdef"
    },
    commandStation: {
      ref: "v5.6.0-Prod",
      commit: "fedcba9876543210"
    },
    target: {
      devicePort: "/dev/csb1",
      dccExHost: "192.168.4.22",
      dccExPort: 2560
    },
    postFlashSensorSetup: {
      attempted: true,
      status: "success",
      reason: null,
      error: null,
      commandCount: 3
    },
    error: null,
    ...overrides
  };
}

async function withServer(env, callback) {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: webRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DCCEX_MOCK: "true",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/health`);
      return response.ok;
    });
    await callback(baseUrl);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child).catch(() => {
      child.kill("SIGKILL");
      throw new Error(`server did not exit cleanly. Output:\n${output}`);
    });
  }
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitFor(check) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("condition timed out");
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
