const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DccExClient } = require("../src/dcc-client");
const { layout } = require("../src/layout");
const {
  SessionRecorder,
  readSessionDirectory,
  redactPayload
} = require("../src/session-recorder");

test("session recorder writes JSONL events and redacts sensitive values", async (t) => {
  const directory = await makeTempDir(t);
  const recorder = new SessionRecorder({
    directory,
    sessionId: "redaction-session",
    now: fixedNow("2026-06-01T10:00:00.000Z", "2026-06-01T10:00:01.000Z")
  });

  await recorder.ready;
  recorder.record("operator.action", {
    token: "plain-secret",
    command: "<X token=abc123 password=guessme>",
    nested: { apiKey: "secret-key", note: "kept" }
  });
  await recorder.flush();

  const raw = await recorder.exportSession("redaction-session");
  assert.match(raw, /"type":"session.started"/);
  assert.match(raw, /"type":"operator.action"/);
  assert.doesNotMatch(raw, /plain-secret|abc123|guessme|secret-key/);
  assert.match(raw, /"note":"kept"/);
  assert.deepEqual(redactPayload({ password: "x", value: "token=y" }), {
    password: "[REDACTED]",
    value: "token=[REDACTED]"
  });
});

test("session recorder captures state and telemetry transitions", async (t) => {
  const directory = await makeTempDir(t);
  const recorder = new SessionRecorder({
    directory,
    sessionId: "state-session",
    now: fixedNow(
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T10:00:10.000Z",
      "2026-06-01T10:00:20.000Z",
      "2026-06-01T10:00:21.000Z",
      "2026-06-01T10:00:22.000Z",
      "2026-06-01T10:00:23.000Z",
      "2026-06-01T10:00:24.000Z"
    )
  });

  await recorder.ready;
  recorder.observeState({
    connection: { connected: true, mock: false, lastMessageAt: "2026-06-01T09:59:50.000Z" },
    messages: [],
    automation: { running: false, stopRequested: false },
    power: { state: "off" },
    turnouts: { 1: { id: 1, label: "T1", state: "closed" } },
    sensors: { 1001: { id: 1001, label: "S1", active: false } }
  }, {
    now: new Date("2026-06-01T10:00:10.000Z"),
    staleAfterMs: 5000
  });
  recorder.observeState({
    connection: { connected: true, mock: false, lastMessageAt: "2026-06-01T10:00:20.000Z" },
    messages: [{ message: "<p1>" }],
    automation: { running: true, stopRequested: false },
    power: { state: "on" },
    turnouts: { 1: { id: 1, label: "T1", state: "thrown" } },
    sensors: { 1001: { id: 1001, label: "S1", active: true } }
  }, {
    now: new Date("2026-06-01T10:00:20.000Z"),
    staleAfterMs: 5000
  });
  await recorder.flush();

  const latest = await recorder.getLatestSession();
  const types = latest.session.recentEvents.map((event) => event.type);
  assert(types.includes("telemetry.stale"));
  assert(types.includes("telemetry.recovered"));
  assert(types.includes("power.changed"));
  assert(types.includes("turnout.changed"));
  assert(types.includes("sensor.changed"));
  assert(types.includes("automation.started"));
});

test("session directory handling prunes old files and reports malformed JSONL", async (t) => {
  const directory = await makeTempDir(t);
  await writeSessionFile(directory, "older", "2026-05-28T10:00:00.000Z");
  await writeSessionFile(directory, "newer", "2026-05-31T10:00:00.000Z");
  await fs.writeFile(path.join(directory, "malformed.jsonl"), "{\"type\":\"ok\"}\nnot-json\n", "utf8");

  const recorder = new SessionRecorder({
    directory,
    sessionId: "current",
    now: fixedNow("2026-06-01T10:00:00.000Z"),
    maxSessions: 2,
    maxAgeDays: 30
  });
  await recorder.ready;

  const files = await fs.readdir(directory);
  assert(!files.includes("older.jsonl"));
  assert(files.includes("current.jsonl"));

  const result = await readSessionDirectory(directory, { includeEvents: true });
  assert(result.warnings.some((warning) => warning.includes("malformed JSONL")));
});

test("DCC client forwards tx and rx messages to the session recorder", async () => {
  const events = [];
  const dcc = new DccExClient({
    host: "mock",
    port: 2560,
    mock: true,
    layout,
    recorder: {
      record(type, payload) {
        events.push({ type, payload });
      }
    }
  });

  dcc.start();
  await dcc.send("<1>");
  dcc.handleData("<p1><Q 1001>");

  assert(events.some((event) => event.type === "dcc.tx" && event.payload.message === "<1>"));
  assert(events.some((event) => event.type === "dcc.rx" && event.payload.message === "<p1>"));
  assert(events.some((event) => event.type === "dcc.rx" && event.payload.message === "<Q 1001>"));
});

test("session APIs export mock operating events without DCC writes from read-only refresh", async (t) => {
  const directory = await makeTempDir(t);
  const port = await getFreePort();
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DCCEX_MOCK: "true",
      SESSION_DATA_DIR: directory,
      SESSION_RETENTION_COUNT: "5",
      SESSION_RETENTION_DAYS: "7"
    },
    stdio: "ignore"
  });
  t.after(() => {
    if (!server.killed) server.kill("SIGTERM");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  const beforeReads = await readSessionEvents(baseUrl);
  const txBeforeReads = countEvents(beforeReads, "dcc.tx");
  await getJson(`${baseUrl}/api/sessions/latest`);
  await getJson(`${baseUrl}/api/sessions`);
  await fetch(`${baseUrl}/`);
  const afterReads = await readSessionEvents(baseUrl);
  assert.equal(countEvents(afterReads, "dcc.tx"), txBeforeReads);

  await postJson(`${baseUrl}/api/power`, { state: "on" });
  await postJson(`${baseUrl}/api/turnouts/1`, { state: "thrown" });
  await postJson(`${baseUrl}/api/command`, { command: "<s 1001 1>" });
  await postJson(`${baseUrl}/api/automation/start`, {});
  await postJson(`${baseUrl}/api/trains/stop-all`, {});

  const events = await readSessionEvents(baseUrl);
  const types = events.map((event) => event.type);
  assert(types.includes("operator.action"));
  assert(types.includes("operator.result"));
  assert(types.includes("dcc.tx"));
  assert(types.includes("power.changed"));
  assert(types.includes("turnout.changed"));
  assert(types.includes("sensor.changed"));
  assert(types.includes("automation.start_requested"));
  assert(types.includes("automation.all_stop_requested"));
});

async function makeTempDir(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "railroad-sessions-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function fixedNow(...values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return new Date(value);
  };
}

async function writeSessionFile(directory, sessionId, at) {
  const filePath = path.join(directory, `${sessionId}.jsonl`);
  const event = { sessionId, at, type: "session.started", payload: {} };
  await fs.writeFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  const date = new Date(at);
  await fs.utimes(filePath, date, date);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Server did not become healthy");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error || response.statusText);
  return payload;
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, response.statusText);
  return response.json();
}

async function readSessionEvents(baseUrl) {
  const latest = await getJson(`${baseUrl}/api/sessions/latest`);
  assert(latest.session?.id);
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(latest.session.id)}/export`);
  assert.equal(response.ok, true, response.statusText);
  const raw = await response.text();
  return raw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function countEvents(events, type) {
  return events.filter((event) => event.type === type).length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
