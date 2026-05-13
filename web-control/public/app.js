let layoutConfig = null;
let state = null;
let authRequired = false;

const tokenInput = document.querySelector("#tokenInput");
const authPanel = document.querySelector("#authPanel");
const connectionSummary = document.querySelector("#connectionSummary");
const automationState = document.querySelector("#automationState");
const sensorGrid = document.querySelector("#sensorGrid");
const turnoutList = document.querySelector("#turnoutList");
const trainList = document.querySelector("#trainList");
const messageLog = document.querySelector("#messageLog");

init();

async function init() {
  tokenInput.value = localStorage.getItem("controlToken") || "";
  tokenInput.addEventListener("change", () => {
    localStorage.setItem("controlToken", tokenInput.value);
  });

  layoutConfig = await apiGet("/api/config");
  authRequired = layoutConfig.authRequired;
  authPanel.classList.toggle("hidden", !authRequired);

  wireGlobalButtons();
  state = await apiGet("/api/state");
  render();
  connectEvents();
}

function wireGlobalButtons() {
  document.querySelector("#refreshButton").addEventListener("click", () => post("/api/refresh"));
  document.querySelector("#startButton").addEventListener("click", () => post("/api/automation/start"));
  document.querySelector("#stopButton").addEventListener("click", () => post("/api/automation/stop"));
  document.querySelector("#emergencyButton").addEventListener("click", () => post("/api/emergency-stop"));
  document.querySelector("#powerOnButton").addEventListener("click", () => post("/api/power", { state: "on" }));
  document.querySelector("#powerOffButton").addEventListener("click", () => post("/api/power", { state: "off" }));
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("state", (event) => {
    state = JSON.parse(event.data);
    render();
  });
  events.onerror = () => {
    connectionSummary.textContent = "Live updates disconnected; retrying...";
  };
}

function render() {
  if (!state || !layoutConfig) return;

  const connection = state.connection;
  const power = state.power.state;
  const target = connection.mock ? "mock command station" : `${connection.host}:${connection.port}`;
  connectionSummary.textContent = `${connection.status} to ${target} | track power ${power}`;
  connectionSummary.className = connection.connected ? "" : "connection-error";

  automationState.textContent = state.automation.stopRequested
    ? "Stopping"
    : state.automation.running
      ? "Running"
      : "Stopped";
  automationState.className = `status-pill ${
    state.automation.stopRequested ? "alert" : state.automation.running ? "running" : "stopped"
  }`;

  renderSensors();
  renderTurnouts();
  renderTrains();
  renderMessages();
}

function renderSensors() {
  sensorGrid.innerHTML = "";
  for (const sensor of layoutConfig.layout.sensors) {
    const live = state.sensors[String(sensor.id)];
    const status = live?.active === true ? "active" : live?.active === false ? "inactive" : "unknown";
    const item = document.createElement("article");
    item.className = "item sensor";
    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHtml(sensor.label)}</h3>
          <div class="meta">Sensor ${sensor.id} | vpin ${sensor.vpin}</div>
        </div>
        <span class="status-pill ${status}">${status}</span>
      </div>
    `;
    sensorGrid.append(item);
  }
}

function renderTurnouts() {
  turnoutList.innerHTML = "";
  for (const turnout of layoutConfig.layout.turnouts) {
    const live = state.turnouts[String(turnout.id)];
    const status = live?.state || "unknown";
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHtml(turnout.label)}</h3>
          <div class="meta">Turnout ${turnout.id}</div>
        </div>
        <span class="status-pill ${status}">${status}</span>
      </div>
      <div class="button-row">
        <button class="button ghost" data-turnout="${turnout.id}" data-state="closed">Close</button>
        <button class="button ghost" data-turnout="${turnout.id}" data-state="thrown">Throw</button>
      </div>
    `;
    item.querySelectorAll("button").forEach((button) => {
      if (button.dataset.state === status) button.classList.add("active");
      button.addEventListener("click", () => post(`/api/turnouts/${turnout.id}`, { state: button.dataset.state }));
    });
    turnoutList.append(item);
  }
}

function renderTrains() {
  trainList.innerHTML = "";
  for (const train of layoutConfig.layout.trains) {
    const live = state.trains[String(train.address)];
    const speed = live?.speed ?? 0;
    const direction = live?.direction ?? "forward";
    const f0 = Boolean(live?.functions?.[0]);
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHtml(train.label)}</h3>
          <div class="meta">DCC address ${train.address}</div>
        </div>
        <span class="status-pill ${speed > 0 ? "running" : "stopped"}">${speed > 0 ? `${speed}` : "stopped"}</span>
      </div>
      <div class="train-controls">
        <div class="field">
          <label>Direction</label>
          <div class="button-row">
            <button class="button ghost direction-button ${direction === "forward" ? "active" : ""}" data-direction="forward">Forward</button>
            <button class="button ghost direction-button ${direction === "reverse" ? "active" : ""}" data-direction="reverse">Reverse</button>
          </div>
        </div>
        <div class="field">
          <label>Speed</label>
          <div class="speed-control">
            <input type="range" min="0" max="127" value="${speed}">
            <input type="number" min="0" max="127" value="${speed}">
          </div>
        </div>
        <div class="button-row">
          <button class="button secondary apply-button">Apply</button>
          <button class="button warning stop-button">Stop</button>
          <button class="button ghost f0-button ${f0 ? "active" : ""}">F0</button>
        </div>
      </div>
    `;

    let selectedDirection = direction;
    const range = item.querySelector('input[type="range"]');
    const number = item.querySelector('input[type="number"]');
    range.addEventListener("input", () => {
      number.value = range.value;
    });
    number.addEventListener("input", () => {
      range.value = number.value;
    });
    item.querySelectorAll(".direction-button").forEach((button) => {
      button.addEventListener("click", () => {
        selectedDirection = button.dataset.direction;
        item.querySelectorAll(".direction-button").forEach((inner) => inner.classList.toggle("active", inner === button));
      });
    });
    item.querySelector(".apply-button").addEventListener("click", () => {
      post(`/api/trains/${train.address}/throttle`, {
        speed: Number(number.value),
        direction: selectedDirection
      });
    });
    item.querySelector(".stop-button").addEventListener("click", () => {
      post(`/api/trains/${train.address}/throttle`, {
        speed: 0,
        direction: selectedDirection
      });
    });
    item.querySelector(".f0-button").addEventListener("click", () => {
      post(`/api/trains/${train.address}/function`, {
        function: 0,
        state: !f0
      });
    });
    trainList.append(item);
  }
}

function renderMessages() {
  messageLog.textContent = state.messages
    .slice(0, 40)
    .map((entry) => `${new Date(entry.at).toLocaleTimeString()} ${entry.direction.toUpperCase()} ${entry.message}`)
    .join("\n");
}

async function post(path, body = {}) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  } catch (error) {
    alert(error.message);
  }
}

async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function authHeaders() {
  if (!authRequired) return {};
  return { Authorization: `Bearer ${tokenInput.value}` };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
