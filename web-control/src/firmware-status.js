const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_FIRMWARE_STATUS_STALE_MS = 30 * 60 * 1000;

async function readFirmwareStatus(filePath, options = {}) {
  const staleAfterMs = normalizeStaleAfterMs(options.staleAfterMs);
  const now = options.now || new Date();
  const configured = Boolean(options.configured);
  const resolvedPath = filePath || defaultFirmwareStatusFile();
  const statusFile = {
    configured,
    name: path.basename(resolvedPath)
  };

  let raw;
  try {
    raw = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return warningPayload("firmware status file missing", statusFile, staleAfterMs);
    }
    return warningPayload("firmware status file unavailable", statusFile, staleAfterMs);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return warningPayload("firmware status file is malformed", statusFile, staleAfterMs);
  }

  return normalizeFirmwareStatus(parsed, { now, staleAfterMs, statusFile });
}

function normalizeFirmwareStatus(status, options = {}) {
  const staleAfterMs = normalizeStaleAfterMs(options.staleAfterMs);
  const now = options.now || new Date();
  const statusFile = options.statusFile || { configured: false, name: null };
  const generatedAt = validIso(status?.generatedAt);
  const ageSeconds = generatedAt ? Math.floor(Math.max(0, dateMs(now) - Date.parse(generatedAt)) / 1000) : null;
  const stale = ageSeconds === null || ageSeconds * 1000 > staleAfterMs;
  const warnings = [];

  if (!generatedAt) warnings.push("firmware status timestamp missing");
  else if (stale) warnings.push("firmware status is stale");

  if (status?.status === "failed" || status?.flash?.decision === "failure") {
    warnings.push("last updater run failed");
  }
  if (status?.flash?.decision === "auto-flash-disabled") {
    warnings.push("automation changed but AUTO_FLASH is disabled");
  }
  if (status?.sensorSetup?.result === "failure") {
    warnings.push("post-flash sensor setup failed");
  }

  return {
    ok: warnings.length === 0,
    state: warnings.length === 0 ? "current" : "warning",
    warning: warnings[0] || null,
    warnings,
    stale,
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    ageSeconds,
    generatedAt,
    statusFile,
    modelRepo: compactObject(status?.modelRepo),
    commandStation: compactObject(status?.commandStation),
    automation: compactObject(status?.automation),
    flash: compactObject(status?.flash),
    sensorSetup: compactObject(status?.sensorSetup),
    error: typeof status?.error === "string" ? status.error : null
  };
}

function warningPayload(message, statusFile, staleAfterMs) {
  return {
    ok: false,
    state: "warning",
    warning: message,
    warnings: [message],
    stale: true,
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    ageSeconds: null,
    generatedAt: null,
    statusFile,
    modelRepo: {},
    commandStation: {},
    automation: {},
    flash: {},
    sensorSetup: {},
    error: null
  };
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function validIso(value) {
  if (typeof value !== "string") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function dateMs(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function normalizeStaleAfterMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_FIRMWARE_STATUS_STALE_MS;
}

function defaultFirmwareStatusFile() {
  return path.join(__dirname, "..", "data", "firmware-status.json");
}

module.exports = {
  DEFAULT_FIRMWARE_STATUS_STALE_MS,
  defaultFirmwareStatusFile,
  normalizeFirmwareStatus,
  readFirmwareStatus
};
