let layoutConfig = null;
let state = null;
let roster = [];
let authRequired = false;

const tokenInput = document.querySelector("#tokenInput");
const authPanel = document.querySelector("#authPanel");
const connectionSummary = document.querySelector("#connectionSummary");
const commandStatus = document.querySelector("#commandStatus");
const rawCommandInput = document.querySelector("#rawCommandInput");
const messageLog = document.querySelector("#messageLog");
const rosterTable = document.querySelector("#rosterTable");

const quickCommands = [
  ["Status", "<s>"],
  ["Roster", "<JR>"],
  ["Turnouts", "<T>"],
  ["Sensors", "<S>"],
  ["Routes", "<JA>"],
  ["Tasks", "</>"],
  ["EEPROM", "<D EEPROM>"],
  ["ACK On", "<D ACK ON>"],
  ["ACK Off", "<D ACK OFF>"],
  ["I2C", "<D I2C>"]
];

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
  wireCommandButtons();
  wireForms();
  renderQuickCommands();

  state = await apiGet("/api/state");
  await loadRoster();
  render();
  connectEvents();
}

function wireGlobalButtons() {
  document.querySelector("#refreshButton").addEventListener("click", () => sendCommand("<s>", "<T>", "<S>", "<Q>", "<JR>"));
  document.querySelector("#powerOnButton").addEventListener("click", () => sendCommand("<1>"));
  document.querySelector("#powerOffButton").addEventListener("click", () => sendCommand("<0>"));
}

function wireCommandButtons() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".command-button");
    if (!button) return;
    sendCommand(button.dataset.command);
  });
}

function wireForms() {
  document.querySelector("#rawCommandForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(rawCommandInput.value);
    rawCommandInput.select();
  });

  document.querySelector("#rosterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      address: valueNumber("#rosterAddress"),
      name: value("#rosterName"),
      manufacturer: value("#rosterManufacturer"),
      model: value("#rosterModel"),
      decoder: value("#rosterDecoder"),
      functions: value("#rosterFunctions"),
      notes: value("#rosterNotes")
    };
    const result = await postJson("/api/roster", payload);
    roster = result.roster;
    renderRoster();
    setStatus(`Saved roster ${payload.address}`, "running");
  });

  document.querySelector("#clearRosterFormButton").addEventListener("click", () => fillRosterForm(null));

  document.querySelector("#cvReadForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<R ${valueNumber("#cvReadCv")}>`);
  });

  document.querySelector("#cvWriteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<W ${valueNumber("#cvWriteCv")} ${valueNumber("#cvWriteValue")}>`);
  });

  document.querySelector("#addressWriteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<W ${valueNumber("#addressWriteValue")}>`);
  });

  document.querySelector("#pomWriteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<w ${valueNumber("#pomCab")} ${valueNumber("#pomCv")} ${valueNumber("#pomValue")}>`);
  });

  document.querySelector("#pomBitForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<b ${valueNumber("#pomBitCab")} ${valueNumber("#pomBitCv")} ${valueNumber("#pomBitNumber")} ${value("#pomBitValue")}>`);
  });

  document.querySelector("#turnoutControlForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<T ${valueNumber("#turnoutControlId")} ${value("#turnoutControlState")}>`);
  });

  document.querySelector("#turnoutDefineForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const commands = [`<T ${valueNumber("#turnoutDefineId")} DCC ${valueNumber("#turnoutDefineLinear")}>`];
    if (document.querySelector("#turnoutDefineSave").checked) commands.push("<E>");
    sendCommand(...commands);
  });

  document.querySelector("#turnoutDeleteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const commands = [`<T ${valueNumber("#turnoutDeleteId")}>`];
    if (document.querySelector("#turnoutDeleteSave").checked) commands.push("<E>");
    sendCommand(...commands);
  });

  document.querySelector("#sensorDefineForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const commands = [`<S ${valueNumber("#sensorDefineId")} ${valueNumber("#sensorDefineVpin")} ${value("#sensorDefinePullup")}>`];
    if (document.querySelector("#sensorDefineSave").checked) commands.push("<E>");
    sendCommand(...commands);
  });

  document.querySelector("#sensorForceForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`<s ${valueNumber("#sensorForceId")} ${value("#sensorForceState")}>`);
  });

  document.querySelector("#sensorDeleteForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const commands = [`<S ${valueNumber("#sensorDeleteId")}>`];
    if (document.querySelector("#sensorDeleteSave").checked) commands.push("<E>");
    sendCommand(...commands);
  });

  document.querySelector("#routeStartForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendCommand(`</START ${valueNumber("#routeStartId")}>`);
  });
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

function renderQuickCommands() {
  const container = document.querySelector("#quickCommands");
  container.innerHTML = "";
  for (const [label, command] of quickCommands) {
    const button = document.createElement("button");
    button.className = "button ghost";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => sendCommand(command));
    container.append(button);
  }
}

function render() {
  if (!state || !layoutConfig) return;

  const connection = state.connection;
  const target = connection.mock ? "mock command station" : `${connection.host}:${connection.port}`;
  connectionSummary.textContent = `${connection.status} to ${target} | track power ${state.power.state}`;
  connectionSummary.className = connection.connected ? "" : "connection-error";
  renderMessages();
}

async function loadRoster() {
  const result = await apiGet("/api/roster");
  roster = result.roster;
  renderRoster();
}

function renderRoster() {
  rosterTable.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Address</th>
        <th>Name</th>
        <th>Decoder</th>
        <th>Functions</th>
        <th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  for (const entry of roster) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.address}</td>
      <td>
        <strong>${escapeHtml(entry.name)}</strong>
        <span>${escapeHtml([entry.manufacturer, entry.model].filter(Boolean).join(" "))}</span>
      </td>
      <td>${escapeHtml(entry.decoder || "")}</td>
      <td>${escapeHtml(entry.functions || "")}</td>
      <td>
        <div class="table-actions">
          <button class="button ghost" type="button" data-action="edit">Edit</button>
          <button class="button ghost" type="button" data-action="select">Use Cab</button>
          <button class="button danger" type="button" data-action="delete">Delete</button>
        </div>
      </td>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => fillRosterForm(entry));
    row.querySelector('[data-action="select"]').addEventListener("click", () => useCab(entry.address));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteRosterEntry(entry.address));
    body.append(row);
  }

  rosterTable.append(table);
}

function fillRosterForm(entry) {
  document.querySelector("#rosterAddress").value = entry?.address || "";
  document.querySelector("#rosterName").value = entry?.name || "";
  document.querySelector("#rosterManufacturer").value = entry?.manufacturer || "";
  document.querySelector("#rosterModel").value = entry?.model || "";
  document.querySelector("#rosterDecoder").value = entry?.decoder || "";
  document.querySelector("#rosterFunctions").value = entry?.functions || "";
  document.querySelector("#rosterNotes").value = entry?.notes || "";
}

function useCab(address) {
  for (const selector of ["#pomCab", "#pomBitCab"]) {
    document.querySelector(selector).value = address;
  }
  rawCommandInput.value = `<t ${address} 0 1>`;
  setStatus(`Cab ${address} selected`, "running");
}

async function deleteRosterEntry(address) {
  const result = await fetch(`/api/roster/${address}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!result.ok) return showError((await result.json()).error || result.statusText);
  roster = (await result.json()).roster;
  renderRoster();
  setStatus(`Deleted roster ${address}`, "alert");
}

function renderMessages() {
  messageLog.textContent = state.messages
    .slice(0, 70)
    .map((entry) => `${new Date(entry.at).toLocaleTimeString()} ${entry.direction.toUpperCase()} ${entry.message}`)
    .join("\n");
}

async function sendCommand(...commands) {
  const clean = commands.map((command) => normalizeCommand(command)).filter(Boolean);
  if (!clean.length) return;

  try {
    if (clean.length === 1) {
      await postJson("/api/command", { command: clean[0] });
      setStatus(`Sent ${clean[0]}`, "running");
    } else {
      await postJson("/api/commands", { commands: clean });
      setStatus(`Sent ${clean.length} commands`, "running");
    }
  } catch (error) {
    showError(error.message);
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function normalizeCommand(command) {
  const clean = String(command || "").trim();
  if (!clean) return "";
  return clean.startsWith("<") ? clean : `<${clean}>`;
}

function authHeaders() {
  if (!authRequired) return {};
  return { Authorization: `Bearer ${tokenInput.value}` };
}

function value(selector) {
  return document.querySelector(selector).value;
}

function valueNumber(selector) {
  return Number(value(selector));
}

function setStatus(message, status) {
  commandStatus.textContent = message.length > 28 ? message.slice(0, 25) + "..." : message;
  commandStatus.className = `status-pill ${status}`;
}

function showError(message) {
  commandStatus.textContent = "Error";
  commandStatus.className = "status-pill error";
  alert(message);
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
