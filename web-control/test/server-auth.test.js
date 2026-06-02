const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { sessionTokenHash } = require("../src/shared-auth");

const webRoot = path.join(__dirname, "..");

test("read-only status and firmware endpoints remain public", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-server-auth-"));
  await withServer({ SHARED_AUTH_DB: path.join(tempDir, "missing-auth.db") }, async (baseUrl) => {
    const state = await fetch(`${baseUrl}/api/state`);
    const firmware = await fetch(`${baseUrl}/api/firmware-status`);

    assert.equal(state.status, 200);
    assert.equal(firmware.status, 200);
  });
});

test("roster writes require SSO plus cookie CSRF and origin guard", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-server-auth-"));
  const dbPath = path.join(tempDir, "auth.db");
  const rosterFile = path.join(tempDir, "roster.json");
  createAuthDb(dbPath, { token: "valid-session", username: "Chris Chang" });

  await withServer({ SHARED_AUTH_DB: dbPath, ROSTER_FILE: rosterFile }, async (baseUrl) => {
    const body = JSON.stringify(rosterEntry());
    const anonymous = await fetch(`${baseUrl}/api/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    assert.equal(anonymous.status, 401);

    const cookie = "projects_lan_session=valid-session";
    const config = await getJson(`${baseUrl}/api/config`, { headers: { Cookie: cookie } });
    assert.equal(config.auth.authenticated, true);
    assert.equal(config.auth.user.username, "Chris Chang");
    assert.ok(config.auth.csrfToken);

    const missingGuard = await fetch(`${baseUrl}/api/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body
    });
    assert.equal(missingGuard.status, 403);

    const allowed = await fetch(`${baseUrl}/api/roster`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: baseUrl,
        "X-CSRF-Token": config.auth.csrfToken
      },
      body
    });
    const payload = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(payload.roster.find((entry) => entry.address === 9).name, "Test Loco");
  });
});

test("physical hardware commands require SSO plus hardware arm", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-server-auth-"));
  const dbPath = path.join(tempDir, "auth.db");
  createAuthDb(dbPath, { token: "valid-session", username: "Chris Chang" });

  await withServer({
    SHARED_AUTH_DB: dbPath,
    HARDWARE_ARM_TOKEN: "arm-now",
    HARDWARE_ARM_TTL_MS: "60000"
  }, async (baseUrl) => {
    const cookie = "projects_lan_session=valid-session";
    const config = await getJson(`${baseUrl}/api/config`, { headers: { Cookie: cookie } });
    const guardedHeaders = {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
      "X-CSRF-Token": config.auth.csrfToken
    };

    const before = await getJson(`${baseUrl}/api/state`);
    const blocked = await fetch(`${baseUrl}/api/power`, {
      method: "POST",
      headers: guardedHeaders,
      body: JSON.stringify({ state: "on" })
    });
    const afterBlocked = await getJson(`${baseUrl}/api/state`);
    assert.equal(blocked.status, 403);
    assert.equal(afterBlocked.messages.length, before.messages.length);

    const armed = await fetch(`${baseUrl}/api/hardware-arm`, {
      method: "POST",
      headers: guardedHeaders,
      body: JSON.stringify({ token: "arm-now" })
    });
    const armPayload = await armed.json();
    assert.equal(armed.status, 200);
    assert.equal(armPayload.hardware.armed, true);

    const allowed = await fetch(`${baseUrl}/api/power`, {
      method: "POST",
      headers: guardedHeaders,
      body: JSON.stringify({ state: "on" })
    });
    assert.equal(allowed.status, 200);
  });
});

test("CONTROL_TOKEN is accepted only when explicit compatibility mode is enabled", async () => {
  await withServer({ CONTROL_TOKEN: "legacy-token" }, async (baseUrl) => {
    const blocked = await fetch(`${baseUrl}/api/refresh`, {
      method: "POST",
      headers: { Authorization: "Bearer legacy-token" },
      body: "{}"
    });
    assert.equal(blocked.status, 401);
  });

  await withServer({ CONTROL_TOKEN: "legacy-token", CONTROL_TOKEN_COMPAT_MODE: "true" }, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/refresh`, {
      method: "POST",
      headers: { Authorization: "Bearer legacy-token" },
      body: "{}"
    });
    assert.equal(allowed.status, 200);
  });
});

function createAuthDb(dbPath, options) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.prepare(`
    INSERT INTO users (username, username_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(options.username, "chris chang", "2026-06-02T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
  db.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at)
    VALUES (1, ?, ?, ?)
  `).run(sessionTokenHash(options.token), "2026-06-02T00:01:00.000Z", new Date(Date.now() + 60 * 60 * 1000).toISOString());
  db.close();
}

function rosterEntry() {
  return {
    address: 9,
    name: "Test Loco",
    manufacturer: "Test",
    model: "Switcher",
    decoder: "DCC",
    functions: "F0",
    notes: "test only"
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

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
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
