const EventEmitter = require("node:events");
const net = require("node:net");

const MAX_LOG_MESSAGES = 120;

class DccExClient extends EventEmitter {
  constructor({ host, port, mock, layout, pollMs = 2000 }) {
    super();
    this.host = host;
    this.port = port;
    this.mock = mock;
    this.layout = layout;
    this.pollMs = pollMs;
    this.socket = null;
    this.buffer = "";
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.state = createInitialState(layout, { host, port, mock });
  }

  start() {
    if (this.mock) {
      this.state.connection.connected = true;
      this.state.connection.status = "mock";
      this.emitState();
      return;
    }

    this.connect();
    this.pollTimer = setInterval(() => {
      if (!this.state.connection.connected) return;
      this.write("<Q>");
      this.write("<T>");
    }, this.pollMs);
  }

  stop() {
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
  }

  getState() {
    return this.state;
  }

  async send(command) {
    assertCommand(command);
    this.record("tx", command);

    if (this.mock) {
      this.applyMockCommand(command);
      this.emitState();
      return { command, mock: true };
    }

    if (!this.socket || !this.state.connection.connected) {
      const error = "DCC-EX command station is not connected";
      this.state.connection.lastError = error;
      this.emitState();
      throw new Error(error);
    }

    this.write(command);
    return { command };
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.state.connection.status = "connecting";
    this.state.connection.lastError = null;
    this.emitState();

    const socket = net.createConnection(
      { host: this.host, port: this.port },
      () => {
        this.socket = socket;
        this.state.connection.connected = true;
        this.state.connection.status = "connected";
        this.state.connection.lastConnectedAt = new Date().toISOString();
        this.emitState();
        this.write("<s>");
        for (const sensor of this.layout.sensors) {
          this.write(`<S ${sensor.id} ${sensor.vpin} ${sensor.pullup ?? 0}>`);
        }
        this.write("<T>");
        this.write("<Q>");
        for (const train of this.layout.trains) {
          this.write(`<t ${train.address}>`);
        }
      }
    );

    socket.setEncoding("utf8");
    socket.setKeepAlive(true, 5000);

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", (error) => {
      this.state.connection.lastError = error.message;
      this.emitState();
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.state.connection.connected = false;
      this.state.connection.status = "disconnected";
      this.emitState();
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });
  }

  write(command) {
    if (!this.socket) return;
    this.socket.write(command);
  }

  handleData(chunk) {
    this.buffer += chunk;
    let start = this.buffer.indexOf("<");
    let end = this.buffer.indexOf(">", start + 1);

    while (start !== -1 && end !== -1) {
      const raw = this.buffer.slice(start, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      this.record("rx", raw);
      this.applyMessage(raw);
      start = this.buffer.indexOf("<");
      end = this.buffer.indexOf(">", start + 1);
    }

    if (this.buffer.length > 4096) this.buffer = "";
  }

  applyMessage(raw) {
    const content = raw.slice(1, -1).trim();
    if (!content) return;

    const tokens = content.split(/\s+/);
    const op = tokens[0];

    if ((op === "Q" || op === "q") && tokens.length === 2) {
      const sensor = this.state.sensors[tokens[1]];
      if (sensor) {
        sensor.active = op === "Q";
        sensor.lastUpdated = new Date().toISOString();
      }
    } else if (op === "H" && tokens.length >= 3) {
      const turnout = this.state.turnouts[tokens[1]];
      const stateToken = tokens[tokens.length - 1];
      if (turnout && (stateToken === "0" || stateToken === "1")) {
        turnout.state = stateToken === "1" ? "thrown" : "closed";
        turnout.lastUpdated = new Date().toISOString();
      }
    } else if (op?.startsWith("p")) {
      const powerToken = op.slice(1, 2);
      if (powerToken === "1" || powerToken === "0") {
        this.state.power.state = powerToken === "1" ? "on" : "off";
        this.state.power.lastUpdated = new Date().toISOString();
      }
    } else if (op === "l" && tokens.length >= 4) {
      this.applyLocoBroadcast(tokens);
    } else if (op?.startsWith("iDCC")) {
      this.state.connection.version = content;
    } else if (op === "X") {
      this.state.connection.lastError = raw;
    }

    this.state.connection.lastMessageAt = new Date().toISOString();
    this.emitState();
  }

  applyLocoBroadcast(tokens) {
    const train = this.state.trains[tokens[1]];
    const speedByte = Number(tokens[3]);
    if (!train || !Number.isFinite(speedByte)) return;

    if (speedByte >= 128) {
      train.direction = "forward";
      train.speed = speedByte === 128 ? 0 : Math.max(0, speedByte - 129);
    } else {
      train.direction = "reverse";
      train.speed = speedByte === 0 ? 0 : Math.max(0, speedByte - 1);
    }

    train.lastUpdated = new Date().toISOString();
  }

  applyMockCommand(command) {
    const content = command.slice(1, -1).trim();
    const tokens = content.split(/\s+/);

    if (content === "/START 100") {
      this.state.automation.running = true;
      this.state.automation.stopRequested = false;
    } else if (content === "/START 110") {
      this.state.automation.stopRequested = true;
      this.state.automation.running = false;
    } else if (content === "/KILL ALL" || content === "!") {
      this.state.automation.running = false;
      this.state.automation.stopRequested = false;
      for (const train of Object.values(this.state.trains)) train.speed = 0;
    } else if (tokens[0] === "T" && tokens.length >= 3) {
      const turnout = this.state.turnouts[tokens[1]];
      if (turnout) turnout.state = tokens[2] === "1" || tokens[2] === "T" ? "thrown" : "closed";
    } else if (tokens[0] === "t" && tokens.length >= 4) {
      const train = this.state.trains[tokens[1]];
      if (train) {
        train.speed = Number(tokens[2]);
        train.direction = tokens[3] === "1" ? "forward" : "reverse";
      }
    } else if (tokens[0] === "F" && tokens.length >= 4) {
      const train = this.state.trains[tokens[1]];
      if (train) train.functions[tokens[2]] = tokens[3] === "1";
    } else if (content === "1" || content === "0") {
      this.state.power.state = content === "1" ? "on" : "off";
    }

    this.state.connection.lastMessageAt = new Date().toISOString();
  }

  record(direction, message) {
    this.state.messages.unshift({
      direction,
      message,
      at: new Date().toISOString()
    });
    this.state.messages = this.state.messages.slice(0, MAX_LOG_MESSAGES);
  }

  emitState() {
    this.emit("state", this.state);
  }
}

function createInitialState(layout, connection) {
  return {
    connection: {
      connected: false,
      status: "disconnected",
      host: connection.host,
      port: connection.port,
      mock: connection.mock,
      version: null,
      lastConnectedAt: null,
      lastMessageAt: null,
      lastError: null
    },
    automation: {
      running: false,
      stopRequested: false
    },
    power: {
      state: "unknown",
      lastUpdated: null
    },
    turnouts: Object.fromEntries(
      layout.turnouts.map((turnout) => [
        String(turnout.id),
        { ...turnout, state: "unknown", lastUpdated: null }
      ])
    ),
    trains: Object.fromEntries(
      layout.trains.map((train) => [
        String(train.address),
        {
          ...train,
          speed: 0,
          direction: "forward",
          functions: { 0: false },
          lastUpdated: null
        }
      ])
    ),
    sensors: Object.fromEntries(
      layout.sensors.map((sensor) => [
        String(sensor.id),
        { ...sensor, active: null, lastUpdated: null }
      ])
    ),
    messages: []
  };
}

function assertCommand(command) {
  if (typeof command !== "string" || !/^<[^<>]*>$/.test(command)) {
    throw new Error(`Invalid DCC-EX command: ${command}`);
  }
}

module.exports = { DccExClient };
