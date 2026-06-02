const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DccExClient } = require("./dcc-client");
const { layout } = require("./layout");
const { buildStopAllTrainCommands } = require("./railroad-commands");
const { DEFAULT_TELEMETRY_STALE_MS, buildHealthPayload } = require("./telemetry-health");
const { DEFAULT_STATUS_FILE, DEFAULT_STALE_MS, readFirmwareStatus } = require("./firmware-status");
const {
  SESSION_COOKIE_NAME,
  getSessionToken,
  getUserBySessionToken,
  normalizeUsername
} = require("./shared-auth");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DCCEX_HOST = process.env.DCCEX_HOST || "192.168.4.22";
const DCCEX_PORT = Number(process.env.DCCEX_PORT || 2560);
const DCCEX_MOCK = String(process.env.DCCEX_MOCK || "").toLowerCase() === "true";
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || "";
const CONTROL_TOKEN_COMPAT_MODE = isTruthy(process.env.CONTROL_TOKEN_COMPAT_MODE);
const HARDWARE_ARM_TOKEN = process.env.HARDWARE_ARM_TOKEN || "";
const HARDWARE_ARM_TTL_MS = positiveNumber(process.env.HARDWARE_ARM_TTL_MS, 15 * 60 * 1000);
const HARDWARE_CONTROL_ALLOWLIST = parseList(process.env.HARDWARE_CONTROL_ALLOWLIST);
const ALLOWED_ORIGINS = parseList(process.env.ALLOWED_ORIGINS);
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ROSTER_FILE = process.env.ROSTER_FILE || path.join(__dirname, "..", "data", "roster.json");
const FIRMWARE_STATUS_FILE = process.env.FIRMWARE_STATUS_FILE || DEFAULT_STATUS_FILE;
const configuredTelemetryStaleMs = Number(process.env.TELEMETRY_STALE_MS || DEFAULT_TELEMETRY_STALE_MS);
const TELEMETRY_STALE_MS =
  Number.isFinite(configuredTelemetryStaleMs) && configuredTelemetryStaleMs > 0
    ? configuredTelemetryStaleMs
    : DEFAULT_TELEMETRY_STALE_MS;
const configuredFirmwareStaleMs = Number(process.env.FIRMWARE_STATUS_STALE_MS || DEFAULT_STALE_MS);
const FIRMWARE_STATUS_STALE_MS =
  Number.isFinite(configuredFirmwareStaleMs) && configuredFirmwareStaleMs > 0
    ? configuredFirmwareStaleMs
    : DEFAULT_STALE_MS;

const dcc = new DccExClient({
  host: DCCEX_HOST,
  port: DCCEX_PORT,
  mock: DCCEX_MOCK,
  layout
});

const sseClients = new Set();
const hardwareArms = new Map();
dcc.on("state", (state) => {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const response of sseClients) response.write(payload);
});
dcc.start();

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/health" && request.method === "GET") {
      return sendJson(response, 200, buildHealthPayload(dcc.getState(), {
        staleAfterMs: TELEMETRY_STALE_MS
      }));
    }

    if (request.url === "/api/events" && request.method === "GET") {
      return handleEvents(request, response);
    }

    if (request.url?.startsWith("/api/")) {
      return await handleApi(request, response);
    }

    return await handleStatic(request, response);
  } catch (error) {
    return sendJson(response, error.statusCode || 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Train web control listening on http://${HOST}:${PORT}`);
  console.log(
    DCCEX_MOCK
      ? "DCC-EX mock mode enabled"
      : `DCC-EX target ${DCCEX_HOST}:${DCCEX_PORT}`
  );
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;
  const authContext = getRequestAuth(request);
  const access = classifyApiAccess(request.method, pathname);

  if (request.method === "GET" && pathname === "/api/config") {
    return sendJson(response, 200, {
      layout,
      authRequired: true,
      auth: buildAuthPayload(authContext),
      dccTarget: { host: DCCEX_HOST, port: DCCEX_PORT, mock: DCCEX_MOCK },
      telemetry: { staleAfterMs: TELEMETRY_STALE_MS },
      firmwareStatus: { staleAfterMs: FIRMWARE_STATUS_STALE_MS }
    });
  }

  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, dcc.getState());
  }

  if (request.method === "GET" && pathname === "/api/firmware-status") {
    return sendJson(response, 200, await readFirmwareStatus({
      filePath: FIRMWARE_STATUS_FILE,
      staleAfterMs: FIRMWARE_STATUS_STALE_MS,
      commandStationVersion: dcc.getState().connection.version
    }));
  }

  if (request.method === "GET" && pathname === "/api/roster") {
    return sendJson(response, 200, { roster: await readRoster() });
  }

  if (access.requiresAuth) {
    requireWriteAccess(request, authContext, access);
  }

  if (request.method === "POST" && pathname === "/api/hardware-arm") {
    const body = await readJson(request);
    return handleHardwareArm(response, authContext, body);
  }

  if (request.method === "DELETE" && pathname === "/api/hardware-arm") {
    if (authContext.user) hardwareArms.delete(String(authContext.user.id));
    return sendJson(response, 200, { ok: true, hardware: hardwareStatus(authContext.user) });
  }

  if (request.method === "POST" && pathname === "/api/command") {
    const body = await readJson(request);
    return sendCommand(response, normalizeCommand(body.command));
  }

  if (request.method === "POST" && pathname === "/api/commands") {
    const body = await readJson(request);
    if (!Array.isArray(body.commands) || body.commands.length < 1 || body.commands.length > 20) {
      return sendJson(response, 400, { error: "commands must contain 1 to 20 commands" });
    }

    try {
      const results = [];
      for (const command of body.commands) {
        results.push(await dcc.send(normalizeCommand(command)));
      }
      return sendJson(response, 200, { ok: true, results });
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
  }

  if (request.method === "POST" && pathname === "/api/roster") {
    const body = await readJson(request);
    const entry = validateRosterEntry(body);
    const roster = await readRoster();
    const index = roster.findIndex((item) => Number(item.address) === entry.address);
    if (index === -1) roster.push(entry);
    else roster[index] = entry;
    roster.sort((left, right) => Number(left.address) - Number(right.address));
    await writeRoster(roster);
    return sendJson(response, 200, { ok: true, roster });
  }

  const rosterMatch = pathname.match(/^\/api\/roster\/(\d+)$/);
  if (request.method === "DELETE" && rosterMatch) {
    const address = Number(rosterMatch[1]);
    const roster = (await readRoster()).filter((item) => Number(item.address) !== address);
    await writeRoster(roster);
    return sendJson(response, 200, { ok: true, roster });
  }

  if (request.method === "POST" && pathname === "/api/automation/start") {
    return sendCommand(response, `</START ${layout.automation.startRoute}>`);
  }

  if (request.method === "POST" && pathname === "/api/automation/stop") {
    return sendCommand(response, `</START ${layout.automation.gracefulStopRoute}>`);
  }

  if (request.method === "POST" && pathname === "/api/emergency-stop") {
    try {
      await dcc.send("</KILL ALL>");
      await dcc.send("<!>");
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
  }

  if (request.method === "POST" && pathname === "/api/power") {
    const body = await readJson(request);
    if (body.state !== "on" && body.state !== "off") {
      return sendJson(response, 400, { error: "state must be on or off" });
    }
    return sendCommand(response, body.state === "on" ? "<1>" : "<0>");
  }

  const turnoutMatch = pathname.match(/^\/api\/turnouts\/(\d+)$/);
  if (request.method === "POST" && turnoutMatch) {
    const body = await readJson(request);
    const turnout = layout.turnouts.find((item) => item.id === Number(turnoutMatch[1]));
    if (!turnout) return sendJson(response, 404, { error: "Unknown turnout" });
    if (body.state !== "thrown" && body.state !== "closed") {
      return sendJson(response, 400, { error: "state must be thrown or closed" });
    }
    return sendCommand(response, `<T ${turnout.id} ${body.state === "thrown" ? 1 : 0}>`);
  }

  const throttleMatch = pathname.match(/^\/api\/trains\/(\d+)\/throttle$/);
  if (request.method === "POST" && throttleMatch) {
    const body = await readJson(request);
    const train = layout.trains.find((item) => item.address === Number(throttleMatch[1]));
    if (!train) return sendJson(response, 404, { error: "Unknown train" });

    const speed = Number(body.speed);
    if (!Number.isInteger(speed) || speed < -1 || speed > 127) {
      return sendJson(response, 400, { error: "speed must be an integer from -1 to 127" });
    }
    if (body.direction !== "forward" && body.direction !== "reverse") {
      return sendJson(response, 400, { error: "direction must be forward or reverse" });
    }
    return sendCommand(response, `<t ${train.address} ${speed} ${body.direction === "forward" ? 1 : 0}>`);
  }

  const functionMatch = pathname.match(/^\/api\/trains\/(\d+)\/function$/);
  if (request.method === "POST" && functionMatch) {
    const body = await readJson(request);
    const train = layout.trains.find((item) => item.address === Number(functionMatch[1]));
    if (!train) return sendJson(response, 404, { error: "Unknown train" });

    const fn = Number(body.function);
    if (!Number.isInteger(fn) || fn < 0 || fn > 68) {
      return sendJson(response, 400, { error: "function must be an integer from 0 to 68" });
    }
    if (typeof body.state !== "boolean") {
      return sendJson(response, 400, { error: "state must be boolean" });
    }
    return sendCommand(response, `<F ${train.address} ${fn} ${body.state ? 1 : 0}>`);
  }

  if (request.method === "POST" && pathname === "/api/trains/stop-all") {
    try {
      const commands = buildStopAllTrainCommands(layout, dcc.getState());
      const results = [];
      for (const command of commands) {
        results.push(await dcc.send(command));
      }
      return sendJson(response, 200, { ok: true, commands, results });
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
  }

  if (request.method === "POST" && pathname === "/api/refresh") {
    try {
      await dcc.send("<s>");
      await dcc.send("<T>");
      await dcc.send("<Q>");
      return sendJson(response, 200, { ok: true });
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
  }

  return sendJson(response, 404, { error: "Not found" });
}

async function sendCommand(response, command) {
  try {
    const result = await dcc.send(command);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(response, 503, { error: error.message });
  }
}

function normalizeCommand(value) {
  const command = String(value || "").trim();
  if (!command) {
    const error = new Error("command is required");
    error.statusCode = 400;
    throw error;
  }
  return command.startsWith("<") ? command : `<${command}>`;
}

async function readRoster() {
  try {
    return JSON.parse(await fs.readFile(ROSTER_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return layout.trains.map((train) => ({
      address: train.address,
      name: train.label,
      manufacturer: train.label.split(" ")[0] || "",
      model: train.label.split(" ").slice(1).join(" "),
      decoder: "",
      functions: "F0/F1/F2",
      notes: ""
    }));
  }
}

async function writeRoster(roster) {
  await fs.mkdir(path.dirname(ROSTER_FILE), { recursive: true });
  await fs.writeFile(ROSTER_FILE, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
}

function validateRosterEntry(body) {
  const address = Number(body.address);
  if (!Number.isInteger(address) || address < 1 || address > 10293) {
    const error = new Error("address must be an integer from 1 to 10293");
    error.statusCode = 400;
    throw error;
  }

  const name = String(body.name || "").trim();
  if (!name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    address,
    name: name.slice(0, 120),
    manufacturer: String(body.manufacturer || "").trim().slice(0, 80),
    model: String(body.model || "").trim().slice(0, 80),
    decoder: String(body.decoder || "").trim().slice(0, 80),
    functions: String(body.functions || "").trim().slice(0, 180),
    notes: String(body.notes || "").trim().slice(0, 1000)
  };
}

function handleEvents(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  response.write(`event: state\ndata: ${JSON.stringify(dcc.getState())}\n\n`);
  sseClients.add(response);
  request.on("close", () => sseClients.delete(response));
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length > 16384) throw new Error("Request body too large");
  return JSON.parse(raw);
}

function classifyApiAccess(method, pathname) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { requiresAuth: false, requiresHardware: false };
  }

  if (pathname === "/api/hardware-arm") {
    return { requiresAuth: true, requiresHardware: false };
  }

  if (pathname === "/api/refresh" || pathname === "/api/roster" || /^\/api\/roster\/\d+$/.test(pathname)) {
    return { requiresAuth: true, requiresHardware: false };
  }

  return { requiresAuth: true, requiresHardware: true };
}

function getRequestAuth(request) {
  if (isLegacyControlTokenAuthorized(request)) {
    return {
      mode: "legacy-control-token",
      user: null,
      sessionToken: "",
      csrfToken: null,
      legacyControlTokenCompat: true
    };
  }

  const sessionToken = getSessionToken(request);
  const user = getUserBySessionToken(sessionToken);
  return {
    mode: user ? "sso" : "anonymous",
    user,
    sessionToken,
    csrfToken: user ? createCsrfToken(sessionToken) : null,
    legacyControlTokenCompat: CONTROL_TOKEN_COMPAT_MODE && Boolean(CONTROL_TOKEN)
  };
}

function requireWriteAccess(request, authContext, access) {
  if (authContext.mode === "legacy-control-token") return authContext;
  if (!authContext.user) {
    throw httpError(401, "Sign in with projects.lan before sending control requests");
  }

  requireCookieWriteGuard(request, authContext);

  if (access.requiresHardware && !hasHardwareAuthority(authContext.user)) {
    throw httpError(403, "Hardware control is not armed for this signed-in user");
  }

  return authContext;
}

function requireCookieWriteGuard(request, authContext) {
  if (!isAllowedOrigin(request)) {
    throw httpError(403, "Unsafe request origin is not allowed");
  }

  const header = request.headers["x-csrf-token"] || "";
  if (!timingSafeEqual(String(header), authContext.csrfToken || "")) {
    throw httpError(403, "Invalid CSRF token");
  }
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin || refererOrigin(request.headers.referer);
  if (!origin) return false;
  return allowedOrigins(request).has(origin);
}

function allowedOrigins(request) {
  const origins = new Set(ALLOWED_ORIGINS);
  const host = firstHeaderValue(request.headers["x-forwarded-host"] || request.headers.host);
  const proto = firstHeaderValue(request.headers["x-forwarded-proto"]) || (request.socket.encrypted ? "https" : "http");
  if (host) {
    origins.add(`${proto}://${host}`);
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return origins;
}

function refererOrigin(referer) {
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function isLegacyControlTokenAuthorized(request) {
  if (!CONTROL_TOKEN_COMPAT_MODE || !CONTROL_TOKEN) return false;
  const header = request.headers.authorization || request.headers["x-control-token"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return timingSafeEqual(token, CONTROL_TOKEN);
}

function createCsrfToken(sessionToken) {
  return crypto.createHmac("sha256", CSRF_SECRET).update(String(sessionToken || ""), "utf8").digest("hex");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildAuthPayload(authContext) {
  return {
    mode: "sso",
    cookieName: SESSION_COOKIE_NAME,
    authenticated: Boolean(authContext.user),
    user: authContext.user ? publicUser(authContext.user) : null,
    csrfToken: authContext.csrfToken,
    legacyControlTokenCompat: authContext.legacyControlTokenCompat,
    hardware: hardwareStatus(authContext.user)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function hardwareStatus(user) {
  const allowlisted = isHardwareAllowlisted(user);
  const armedUntil = user ? hardwareArms.get(String(user.id)) || 0 : 0;
  const armed = armedUntil > Date.now();
  if (user && !armed) hardwareArms.delete(String(user.id));
  return {
    required: true,
    allowed: allowlisted || armed,
    allowlisted,
    armed,
    armConfigured: Boolean(HARDWARE_ARM_TOKEN),
    armedUntil: armed ? new Date(armedUntil).toISOString() : null,
    armTtlMs: HARDWARE_ARM_TTL_MS
  };
}

function hasHardwareAuthority(user) {
  return hardwareStatus(user).allowed;
}

function isHardwareAllowlisted(user) {
  if (!user) return false;
  const candidates = new Set([
    String(user.id),
    `id:${user.id}`,
    normalizeUsername(user.username),
    normalizeUsername(user.usernameKey)
  ]);
  return HARDWARE_CONTROL_ALLOWLIST.some((entry) => candidates.has(normalizeUsername(entry)));
}

function handleHardwareArm(response, authContext, body) {
  if (!authContext.user) throw httpError(401, "Sign in with projects.lan before arming hardware control");
  if (!HARDWARE_ARM_TOKEN) throw httpError(403, "Hardware arm token is not configured");
  if (!timingSafeEqual(body.token || "", HARDWARE_ARM_TOKEN)) {
    throw httpError(403, "Invalid hardware arm token");
  }

  hardwareArms.set(String(authContext.user.id), Date.now() + HARDWARE_ARM_TTL_MS);
  return sendJson(response, 200, { ok: true, hardware: hardwareStatus(authContext.user) });
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  const extension = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}

function shutdown() {
  dcc.stop();
  server.close(() => process.exit(0));
}
