const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DccExClient } = require("./dcc-client");
const { layout } = require("./layout");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DCCEX_HOST = process.env.DCCEX_HOST || "192.168.4.22";
const DCCEX_PORT = Number(process.env.DCCEX_PORT || 2560);
const DCCEX_MOCK = String(process.env.DCCEX_MOCK || "").toLowerCase() === "true";
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || "";
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ROSTER_FILE = process.env.ROSTER_FILE || path.join(__dirname, "..", "data", "roster.json");

const dcc = new DccExClient({
  host: DCCEX_HOST,
  port: DCCEX_PORT,
  mock: DCCEX_MOCK,
  layout
});

const sseClients = new Set();
dcc.on("state", (state) => {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const response of sseClients) response.write(payload);
});
dcc.start();

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/health" && request.method === "GET") {
      const state = dcc.getState();
      return sendJson(response, 200, {
        ok: true,
        service: "model-railroad-web-control",
        connection: state.connection
      });
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

  if (request.method === "GET" && pathname === "/api/config") {
    return sendJson(response, 200, {
      layout,
      authRequired: Boolean(CONTROL_TOKEN),
      dccTarget: { host: DCCEX_HOST, port: DCCEX_PORT, mock: DCCEX_MOCK }
    });
  }

  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, dcc.getState());
  }

  if (request.method === "GET" && pathname === "/api/roster") {
    return sendJson(response, 200, { roster: await readRoster() });
  }

  requireControlToken(request);

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

function requireControlToken(request) {
  if (!CONTROL_TOKEN) return;
  const header = request.headers.authorization || request.headers["x-control-token"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== CONTROL_TOKEN) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
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
