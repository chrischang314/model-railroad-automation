(function firmwareStatusView(globalScope) {
  function renderFirmwareStatusPanel(container, payload, connectionVersion) {
    const view = buildFirmwareStatusView(payload, connectionVersion);
    container.className = `firmware-status ${view.state}`;
    container.innerHTML = `
      <div class="firmware-status-head">
        <div>
          <h3>${escapeHtml(view.title)}</h3>
          <div class="meta">${escapeHtml(view.message)}</div>
        </div>
        <span class="status-pill ${view.pillClass}">${escapeHtml(view.stateLabel)}</span>
      </div>
      <dl class="firmware-grid">
        ${view.rows.map((row) => `
          <div>
            <dt>${escapeHtml(row.label)}</dt>
            <dd>${escapeHtml(row.value)}</dd>
          </div>
        `).join("")}
      </dl>
    `;
    return view;
  }

  function buildFirmwareStatusView(payload, connectionVersion) {
    const response = payload || {};
    const artifact = response.artifact || {};
    const state = response.state || "missing";
    const attention = state !== "current";
    const lastProof = artifact.flashedAt || artifact.baselineAt || artifact.recordedAt || "Not recorded";
    const setup = artifact.postFlashSensorSetup || {};

    return {
      state,
      stateLabel: state.replace(/-/g, " "),
      pillClass: attention ? (state === "error" ? "error" : "alert") : "running",
      title: attention ? "Firmware Proof Needs Attention" : "Firmware Proof Current",
      message: response.message || "Firmware status has not loaded yet.",
      rows: [
        {
          label: "Live DCC-EX",
          value: connectionVersion || response.commandStationVersion || "Not reported"
        },
        {
          label: "Automation",
          value: artifact.automation?.version || "Unknown version"
        },
        {
          label: "Tracked hash",
          value: artifact.trackedHash || artifact.automation?.hash || "Missing"
        },
        {
          label: "Last proof",
          value: formatDateTime(lastProof)
        },
        {
          label: "Updater decision",
          value: artifact.decision || "Unknown"
        },
        {
          label: "Sensor setup",
          value: formatSensorSetup(setup)
        }
      ]
    };
  }

  function formatSensorSetup(setup) {
    if (!setup || setup.status === "unknown") return "Unknown";
    if (setup.reason) return `${setup.status}: ${setup.reason}`;
    if (setup.error) return `${setup.status}: ${setup.error}`;
    return setup.status;
  }

  function formatDateTime(value) {
    if (!value || value === "Not recorded") return "Not recorded";
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value;
    return new Date(timestamp).toLocaleString();
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

  const api = { buildFirmwareStatusView, renderFirmwareStatusPanel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.FirmwareStatusView = api;
})(typeof window !== "undefined" ? window : globalThis);
