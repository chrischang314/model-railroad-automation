const fs = require("node:fs/promises");
const path = require("node:path");
const { buildTelemetrySummary } = require("./telemetry-health");

const DEFAULT_SESSION_RETENTION_COUNT = 10;
const DEFAULT_SESSION_RETENTION_DAYS = 7;
const MAX_RECENT_EVENTS = 40;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key|wifi)/i;
const SENSITIVE_TEXT_PATTERN =
  /\b(token|password|secret|authorization|cookie|api[-_]?key)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

class SessionRecorder {
  constructor(options = {}) {
    this.directory = options.directory || path.join(__dirname, "..", "data", "sessions");
    this.maxSessions = normalizePositiveInteger(options.maxSessions, DEFAULT_SESSION_RETENTION_COUNT);
    this.maxAgeDays = normalizePositiveInteger(options.maxAgeDays, DEFAULT_SESSION_RETENTION_DAYS);
    this.now = options.now || (() => new Date());
    this.sessionId = options.sessionId || createSessionId(this.now());
    this.filePath = path.join(this.directory, `${this.sessionId}.jsonl`);
    this.recentEvents = [];
    this.eventCount = 0;
    this.sequence = 0;
    this.lastEventAt = null;
    this.warnings = [];
    this.stateSnapshot = null;
    this.telemetryStale = null;
    this.staleStartedAt = null;
    this.queue = Promise.resolve();
    this.ready = this.initialize(options.metadata || {});
  }

  async initialize(metadata) {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await this.pruneSessions();
      const event = this.buildEvent("session.started", {
        sessionId: this.sessionId,
        dataDirectory: this.directory,
        retention: {
          maxSessions: this.maxSessions,
          maxAgeDays: this.maxAgeDays
        },
        ...metadata
      });
      this.storeEvent(event);
      await this.appendEvent(event);
    } catch (error) {
      this.addWarning(`Session recorder unavailable: ${error.message}`);
    }
  }

  record(type, payload = {}) {
    const event = this.buildEvent(type, payload);
    this.storeEvent(event);
    this.queue = this.queue
      .then(() => this.ready)
      .then(() => this.appendEvent(event))
      .catch((error) => {
        this.addWarning(`Session event was not written: ${error.message}`);
      });
    return event;
  }

  observeState(state, options = {}) {
    const nextSnapshot = snapshotState(state);
    const previousSnapshot = this.stateSnapshot;
    this.stateSnapshot = nextSnapshot;

    if (previousSnapshot) {
      this.recordCollectionChanges("sensor.changed", previousSnapshot.sensors, nextSnapshot.sensors, "active");
      this.recordCollectionChanges("turnout.changed", previousSnapshot.turnouts, nextSnapshot.turnouts, "state");
      this.recordScalarChange("power.changed", previousSnapshot.power, nextSnapshot.power, "state");
      this.recordAutomationChanges(previousSnapshot.automation, nextSnapshot.automation);
    }

    this.observeTelemetry(state, options);
  }

  async flush() {
    await this.ready.catch(() => {});
    await this.queue;
  }

  async listSessions(options = {}) {
    const directoryResult = await readSessionDirectory(this.directory, {
      includeEvents: Boolean(options.includeEvents)
    });
    directoryResult.recorderWarnings = [...this.warnings];
    return directoryResult;
  }

  async getLatestSession() {
    const result = await this.listSessions({ includeEvents: true });
    const warnings = [...result.warnings, ...result.recorderWarnings];
    if (!result.sessions.length) warnings.push("No session files are available yet.");
    return {
      ok: true,
      session: result.sessions[0] || null,
      warnings
    };
  }

  async exportSession(sessionId) {
    if (!/^[A-Za-z0-9_.-]+$/.test(sessionId || "")) {
      const error = new Error("Invalid session id");
      error.statusCode = 400;
      throw error;
    }

    try {
      return await fs.readFile(path.join(this.directory, `${sessionId}.jsonl`), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        const notFound = new Error("Session not found");
        notFound.statusCode = 404;
        throw notFound;
      }
      throw error;
    }
  }

  buildEvent(type, payload) {
    const at = toIsoString(this.now());
    this.sequence += 1;
    return {
      id: `${this.sessionId}-${String(this.sequence).padStart(6, "0")}`,
      sessionId: this.sessionId,
      at,
      type,
      payload: redactPayload(payload)
    };
  }

  storeEvent(event) {
    this.eventCount += 1;
    this.lastEventAt = event.at;
    this.recentEvents.unshift(event);
    this.recentEvents = this.recentEvents.slice(0, MAX_RECENT_EVENTS);
  }

  async appendEvent(event) {
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async pruneSessions() {
    const entries = await listSessionFiles(this.directory);
    const cutoffMs = this.now().getTime() - this.maxAgeDays * 24 * 60 * 60 * 1000;
    const keepCount = Math.max(0, this.maxSessions - 1);
    const keep = new Set(entries.slice(0, keepCount).map((entry) => entry.fileName));

    await Promise.all(entries.map(async (entry) => {
      if (entry.fileName === `${this.sessionId}.jsonl`) return;
      const overCount = !keep.has(entry.fileName);
      const overAge = entry.mtimeMs < cutoffMs;
      if (!overCount && !overAge) return;
      await fs.rm(path.join(this.directory, entry.fileName), { force: true });
    }));
  }

  recordCollectionChanges(type, previousItems, nextItems, field) {
    const keys = new Set([...Object.keys(previousItems || {}), ...Object.keys(nextItems || {})]);
    for (const key of keys) {
      const previous = previousItems?.[key] || null;
      const next = nextItems?.[key] || null;
      if (!previous || !next || previous[field] === next[field]) continue;
      this.record(type, {
        id: next.id ?? previous.id ?? key,
        label: next.label || previous.label || null,
        field,
        from: previous[field] ?? null,
        to: next[field] ?? null
      });
    }
  }

  recordScalarChange(type, previous, next, field) {
    if (!previous || !next || previous[field] === next[field]) return;
    this.record(type, {
      field,
      from: previous[field] ?? null,
      to: next[field] ?? null
    });
  }

  recordAutomationChanges(previous, next) {
    if (!previous || !next) return;
    if (!previous.running && next.running) {
      this.record("automation.started", { from: previous, to: next });
    } else if (previous.running && !next.running) {
      this.record("automation.stopped", { from: previous, to: next });
    }

    if (!previous.stopRequested && next.stopRequested) {
      this.record("automation.stop_requested", { from: previous, to: next });
    } else if (previous.stopRequested && !next.stopRequested) {
      this.record("automation.stop_cleared", { from: previous, to: next });
    }
  }

  observeTelemetry(state, options = {}) {
    const summary = buildTelemetrySummary(state, options);
    const stale = Boolean(summary.stale);
    const previous = this.telemetryStale;
    this.telemetryStale = stale;

    if (previous === stale) return;

    if (stale) {
      this.staleStartedAt = toIsoString(this.now());
      this.record("telemetry.stale", {
        staleStartedAt: this.staleStartedAt,
        lastMessageAt: summary.lastMessageAt,
        ageSeconds: summary.ageSeconds,
        staleAfterSeconds: summary.staleAfterSeconds
      });
      return;
    }

    if (previous === true) {
      const recoveredAt = toIsoString(this.now());
      const durationMs = this.staleStartedAt
        ? Math.max(0, Date.parse(recoveredAt) - Date.parse(this.staleStartedAt))
        : null;
      this.record("telemetry.recovered", {
        staleStartedAt: this.staleStartedAt,
        recoveredAt,
        durationMs,
        lastMessageAt: summary.lastMessageAt,
        ageSeconds: summary.ageSeconds
      });
      this.staleStartedAt = null;
    }
  }

  addWarning(message) {
    this.warnings.push(message);
    this.warnings = this.warnings.slice(-10);
  }
}

async function readSessionDirectory(directory, options = {}) {
  const warnings = [];
  let entries;

  try {
    entries = await listSessionFiles(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        ok: true,
        sessions: [],
        warnings: [`Session directory does not exist: ${directory}`]
      };
    }
    return {
      ok: true,
      sessions: [],
      warnings: [`Session directory is unavailable: ${error.message}`]
    };
  }

  const sessions = [];
  for (const entry of entries) {
    const session = await readSessionFile(path.join(directory, entry.fileName), {
      fileName: entry.fileName,
      mtime: entry.mtime,
      includeEvents: Boolean(options.includeEvents)
    });
    sessions.push(session);
    warnings.push(...session.warnings);
  }

  sessions.sort((left, right) => {
    const leftTime = Date.parse(left.lastEventAt || left.startedAt || left.modifiedAt || 0);
    const rightTime = Date.parse(right.lastEventAt || right.startedAt || right.modifiedAt || 0);
    return rightTime - leftTime;
  });

  return { ok: true, sessions, warnings };
}

async function readSessionFile(filePath, options = {}) {
  const fileName = options.fileName || path.basename(filePath);
  const idFromFile = fileName.replace(/\.jsonl$/i, "");
  const warnings = [];
  let raw = "";

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return {
      id: idFromFile,
      fileName,
      startedAt: null,
      lastEventAt: null,
      modifiedAt: options.mtime ? options.mtime.toISOString() : null,
      eventCount: 0,
      typeCounts: {},
      recentEvents: [],
      warnings: [`Session file ${fileName} is unavailable: ${error.message}`]
    };
  }

  const events = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      warnings.push(`Session file ${fileName} has malformed JSONL at line ${index + 1}.`);
    }
  });

  const first = events[0] || null;
  const last = events[events.length - 1] || null;
  const typeCounts = {};
  for (const event of events) {
    typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
  }

  return {
    id: first?.sessionId || idFromFile,
    fileName,
    startedAt: first?.at || null,
    lastEventAt: last?.at || null,
    modifiedAt: options.mtime ? options.mtime.toISOString() : null,
    eventCount: events.length,
    typeCounts,
    recentEvents: options.includeEvents ? events.slice(-MAX_RECENT_EVENTS).reverse() : [],
    warnings
  };
}

async function listSessionFiles(directory) {
  const fileNames = (await fs.readdir(directory)).filter((fileName) => fileName.endsWith(".jsonl"));
  const entries = await Promise.all(fileNames.map(async (fileName) => {
    const stats = await fs.stat(path.join(directory, fileName));
    return {
      fileName,
      mtime: stats.mtime,
      mtimeMs: stats.mtimeMs
    };
  }));
  return entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function snapshotState(state) {
  return {
    automation: {
      running: Boolean(state?.automation?.running),
      stopRequested: Boolean(state?.automation?.stopRequested)
    },
    power: {
      state: state?.power?.state || "unknown"
    },
    turnouts: Object.fromEntries(Object.entries(state?.turnouts || {}).map(([key, turnout]) => [
      key,
      {
        id: turnout.id ?? Number(key),
        label: turnout.label || null,
        state: turnout.state || "unknown"
      }
    ])),
    sensors: Object.fromEntries(Object.entries(state?.sensors || {}).map(([key, sensor]) => [
      key,
      {
        id: sensor.id ?? Number(key),
        label: sensor.label || null,
        active: sensor.active ?? null
      }
    ]))
  };
}

function redactPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactPayload(item));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactText(value) : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactPayload(nested)
  ]));
}

function redactText(value) {
  return String(value).replace(SENSITIVE_TEXT_PATTERN, (_match, key) => `${key}=[REDACTED]`);
}

function createSessionId(now = new Date()) {
  return `${toIsoString(now).replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}`;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

module.exports = {
  DEFAULT_SESSION_RETENTION_COUNT,
  DEFAULT_SESSION_RETENTION_DAYS,
  SessionRecorder,
  createSessionId,
  normalizePositiveInteger,
  readSessionDirectory,
  redactPayload
};
