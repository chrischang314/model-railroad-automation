const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STATUS_FILE = path.join(__dirname, "..", "data", "firmware-status.json");
const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

async function readFirmwareStatus({
  filePath = DEFAULT_STATUS_FILE,
  commandStationVersion = null,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_MS
} = {}) {
  const base = {
    ok: false,
    state: "missing",
    severity: "warning",
    message: "No updater status artifact has been recorded yet.",
    commandStationVersion,
    checkedAt: now.toISOString(),
    artifact: null
  };

  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return base;
    return {
      ...base,
      state: "unavailable",
      message: `Firmware status file is unavailable: ${shortText(error.message)}`
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return {
      ...base,
      state: "malformed",
      message: "Firmware status file exists but is not valid JSON."
    };
  }

  const artifact = normalizeArtifact(parsed);
  const stale = isStale(artifact.recordedAt, now, staleAfterMs);
  const artifactState = normalizeArtifactState(artifact.status);
  const state = artifactState === "error" ? "error" : stale ? "stale" : artifactState;
  const severity = state === "current" ? "normal" : state === "error" ? "error" : "warning";

  return {
    ok: state === "current",
    state,
    severity,
    message: messageForState(state, artifact),
    commandStationVersion,
    checkedAt: now.toISOString(),
    artifact
  };
}

function normalizeArtifact(value) {
  const artifact = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: artifact.schemaVersion ?? null,
    status: shortText(artifact.status || "warning", 40),
    decision: shortText(artifact.decision || "unknown", 80),
    message: shortText(artifact.message || "", 180),
    recordedAt: shortText(artifact.recordedAt || "", 60) || null,
    baselineAt: shortText(artifact.baselineAt || "", 60) || null,
    flashedAt: shortText(artifact.flashedAt || "", 60) || null,
    trackedHash: boundedHash(artifact.trackedHash),
    previousHash: boundedHash(artifact.previousHash),
    automation: {
      file: shortText(artifact.automation?.file || "", 160) || null,
      version: shortText(artifact.automation?.version || "", 80) || null,
      hash: boundedHash(artifact.automation?.hash)
    },
    config: {
      file: shortText(artifact.config?.file || "", 160) || null,
      hash: boundedHash(artifact.config?.hash)
    },
    modelRepo: {
      ref: shortText(artifact.modelRepo?.ref || "", 80) || null,
      checkedOutRef: shortText(artifact.modelRepo?.checkedOutRef || "", 80) || null,
      commit: boundedHash(artifact.modelRepo?.commit, 40)
    },
    commandStation: {
      ref: shortText(artifact.commandStation?.ref || "", 80) || null,
      commit: boundedHash(artifact.commandStation?.commit, 40)
    },
    target: {
      devicePort: shortText(artifact.target?.devicePort || "", 120) || null,
      dccExHost: shortText(artifact.target?.dccExHost || "", 120) || null,
      dccExPort: artifact.target?.dccExPort ?? null
    },
    postFlashSensorSetup: {
      attempted: Boolean(artifact.postFlashSensorSetup?.attempted),
      status: shortText(artifact.postFlashSensorSetup?.status || "unknown", 40),
      reason: shortText(artifact.postFlashSensorSetup?.reason || "", 160) || null,
      error: shortText(artifact.postFlashSensorSetup?.error || "", 180) || null,
      commandCount: Number(artifact.postFlashSensorSetup?.commandCount || 0)
    },
    error: shortText(artifact.error || "", 220) || null
  };
}

function normalizeArtifactState(status) {
  if (status === "current") return "current";
  if (status === "error") return "error";
  return "warning";
}

function isStale(recordedAt, now, staleAfterMs) {
  if (!recordedAt) return true;
  const recordedMs = Date.parse(recordedAt);
  if (!Number.isFinite(recordedMs)) return true;
  return now.getTime() - recordedMs > staleAfterMs;
}

function messageForState(state, artifact) {
  if (state === "current") return artifact.message || "Firmware status is current.";
  if (state === "stale") return "Firmware status proof is older than the configured freshness window.";
  if (state === "error") return artifact.error || artifact.message || "Last updater run failed.";
  return artifact.message || "Firmware status needs attention.";
}

function shortText(value, max = 120) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function boundedHash(value, length = 96) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > length ? text.slice(0, length) : text;
}

module.exports = {
  DEFAULT_STATUS_FILE,
  DEFAULT_STALE_MS,
  readFirmwareStatus,
  normalizeArtifact
};
