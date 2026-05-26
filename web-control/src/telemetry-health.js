const DEFAULT_TELEMETRY_STALE_MS = 15000;

function buildHealthPayload(state, options = {}) {
  const telemetry = buildTelemetrySummary(state, options);
  const connected = Boolean(state?.connection?.connected);

  return {
    ok: connected && !telemetry.stale,
    service: "model-railroad-web-control",
    connection: state?.connection || null,
    telemetry,
    power: state?.power || null,
    automation: state?.automation || null,
    movingTrains: getMovingTrains(state),
    activeSensors: getActiveSensors(state)
  };
}

function buildTelemetrySummary(state, options = {}) {
  const connection = state?.connection || {};
  const staleAfterMs = normalizeStaleAfterMs(options.staleAfterMs);
  const ageMs = ageSince(connection.lastMessageAt, options.now);
  const stale =
    Boolean(connection.connected) &&
    !connection.mock &&
    (ageMs === null || ageMs > staleAfterMs);

  return {
    stale,
    staleAfterSeconds: Math.round(staleAfterMs / 1000),
    lastMessageAt: connection.lastMessageAt || null,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    messageCount: Array.isArray(state?.messages) ? state.messages.length : 0
  };
}

function getMovingTrains(state) {
  return Object.values(state?.trains || {})
    .filter((train) => Number(train.speed) > 0)
    .map((train) => ({
      address: train.address,
      label: train.label,
      speed: train.speed,
      direction: train.direction
    }));
}

function getActiveSensors(state) {
  return Object.values(state?.sensors || {})
    .filter((sensor) => sensor.active === true)
    .map((sensor) => ({
      id: sensor.id,
      label: sensor.label,
      vpin: sensor.vpin
    }));
}

function ageSince(value, nowValue = new Date()) {
  if (!value) return null;

  const then = Date.parse(value);
  const now = nowValue instanceof Date ? nowValue.getTime() : Date.parse(nowValue);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;

  return Math.max(0, now - then);
}

function normalizeStaleAfterMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_TELEMETRY_STALE_MS;
}

module.exports = {
  DEFAULT_TELEMETRY_STALE_MS,
  buildHealthPayload,
  buildTelemetrySummary
};
