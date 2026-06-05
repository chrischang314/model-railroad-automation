const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

const nodePath = process.execPath;

test("mock control mode allows unauthenticated writes for local testing", async () => {
  const port = await getFreePort();
  const child = startServer(port, { DCCEX_MOCK: "true" });

  try {
    await waitForHealthy(port);
    const config = await getJson(port, "/api/config");
    assert.equal(config.authRequired, false);
    assert.equal(config.authConfigured, false);

    const response = await postJson(port, "/api/power", { state: "on" });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  } finally {
    await stopServer(child);
  }
});

test("real control mode fails closed when no control token is configured", async () => {
  const port = await getFreePort();
  const child = startServer(port, { DCCEX_MOCK: "false" });

  try {
    await waitForHealthy(port);
    const config = await getJson(port, "/api/config");
    assert.equal(config.authRequired, true);
    assert.equal(config.authConfigured, false);

    const response = await postJson(port, "/api/power", { state: "on" });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "Control token is not configured");
  } finally {
    await stopServer(child);
  }
});

test("real control mode allows unauthenticated writes when explicitly enabled", async () => {
  const port = await getFreePort();
  const child = startServer(port, {
    ALLOW_UNAUTHENTICATED_CONTROL: "true",
    DCCEX_HOST: "127.0.0.1",
    DCCEX_MOCK: "false"
  });

  try {
    await waitForHealthy(port);
    const config = await getJson(port, "/api/config");
    assert.equal(config.authRequired, false);
    assert.equal(config.authConfigured, false);

    const response = await postJson(port, "/api/power", { state: "on" });
    assert.equal(response.status, 503);
    assert.match(response.body.error, /command station is not connected/i);
  } finally {
    await stopServer(child);
  }
});

test("configured control token is required before real writes reach DCC-EX", async () => {
  const port = await getFreePort();
  const child = startServer(port, {
    CONTROL_TOKEN: "correct-token",
    DCCEX_HOST: "127.0.0.1",
    DCCEX_MOCK: "false"
  });

  try {
    await waitForHealthy(port);
    const config = await getJson(port, "/api/config");
    assert.equal(config.authRequired, true);
    assert.equal(config.authConfigured, true);

    const rejected = await postJson(port, "/api/power", { state: "on" });
    assert.equal(rejected.status, 401);

    const accepted = await postJson(
      port,
      "/api/power",
      { state: "on" },
      { Authorization: "Bearer correct-token" }
    );
    assert.equal(accepted.status, 503);
    assert.match(accepted.body.error, /command station is not connected/i);
  } finally {
    await stopServer(child);
  }
});

function startServer(port, env = {}) {
  return spawn(nodePath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(port, path, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function getFreePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealthy(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for server");
}

async function stopServer(child) {
  child.kill();
  await once(child, "exit").catch(() => {});
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
