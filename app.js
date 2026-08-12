const SHEET_ID = "19NMJyjtPNBEqm_STpbVeO69UbymsL7F78h5uX_7xeE8";
const SHEET_GID = "0";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const state = {
  rows: [],
  calls: [],
  columns: {},
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  agentFilter: document.querySelector("#agentFilter"),
  periodFilter: document.querySelector("#periodFilter"),
  dateFilter: document.querySelector("#dateFilter"),
  statusPanel: document.querySelector("#statusPanel"),
  totalCalls: document.querySelector("#totalCalls"),
  shopCount: document.querySelector("#shopCount"),
  taskCount: document.querySelector("#taskCount"),
  busiestHour: document.querySelector("#busiestHour"),
  rangeLabel: document.querySelector("#rangeLabel"),
  shopLabel: document.querySelector("#shopLabel"),
  taskLabel: document.querySelector("#taskLabel"),
  logLabel: document.querySelector("#logLabel"),
  hourChart: document.querySelector("#hourChart"),
  shopChart: document.querySelector("#shopChart"),
  taskChart: document.querySelector("#taskChart"),
  callLog: document.querySelector("#callLog"),
};

const columnAliases = {
  agent: ["agent", "caller", "call agent", "bdc agent", "employee", "rep", "representative"],
  shop: ["shop", "store", "location", "called shop", "shop called", "company", "business"],
  task: ["task", "task type", "call type", "type", "reason", "category", "activity type"],
  timestamp: ["timestamp", "datetime", "date time", "created at", "call datetime", "call date time"],
  date: ["date", "call date", "day"],
  time: ["time", "call time", "start time"],
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted && char === '"' && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), (row[index] || "").trim()])),
  );
}

function findColumn(headers, aliases) {
  const normalized = headers.map((header) => [header, normalizeHeader(header)]);
  return normalized.find(([, header]) => aliases.includes(header))?.[0]
    || normalized.find(([, header]) => aliases.some((alias) => header.includes(alias)))?.[0]
    || null;
}

function inferColumns(rows) {
  const headers = Object.keys(rows[0] || {});
  return Object.fromEntries(
    Object.entries(columnAliases).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  );
}

function parseCallDate(row, columns) {
  const timestamp = columns.timestamp ? row[columns.timestamp] : "";
  const date = columns.date ? row[columns.date] : "";
  const time = columns.time ? row[columns.time] : "";
  const candidates = [timestamp, `${date} ${time}`.trim(), date].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function clean(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildCalls(rows, columns) {
  return rows
    .map((row) => {
      const calledAt = parseCallDate(row, columns);
      if (!calledAt) return null;
      return {
        calledAt,
        agent: clean(columns.agent ? row[columns.agent] : "", "Unassigned"),
        shop: clean(columns.shop ? row[columns.shop] : "", "Unknown shop"),
        task: clean(columns.task ? row[columns.task] : "", "Uncategorized"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.calledAt - a.calledAt);
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getRange() {
  const selected = els.dateFilter.value ? new Date(`${els.dateFilter.value}T00:00:00`) : new Date();
  const period = els.periodFilter.value;
  const start = period === "month" ? startOfMonth(selected) : period === "week" ? startOfWeek(selected) : selected;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else if (period === "week") end.setDate(end.getDate() + 7);
  else end.setDate(end.getDate() + 1);
  return { start, end, period };
}

function countBy(items, key) {
  return items.reduce((map, item) => {
    const value = item[key];
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map());
}

function topEntries(map, limit = 12) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function setStatus(message, isError = false) {
  els.statusPanel.textContent = message;
  els.statusPanel.classList.toggle("error", isError);
}

function populateAgents() {
  const agents = [...new Set(state.calls.map((call) => call.agent))].sort((a, b) => a.localeCompare(b));
  els.agentFilter.innerHTML = `<option value="all">All agents</option>${agents
    .map((agent) => `<option value="${escapeHtml(agent)}">${escapeHtml(agent)}</option>`)
    .join("")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function filteredCalls() {
  const { start, end } = getRange();
  const agent = els.agentFilter.value;
  return state.calls.filter((call) => {
    const inDate = call.calledAt >= start && call.calledAt < end;
    const inAgent = agent === "all" || call.agent === agent;
    return inDate && inAgent;
  });
}

function renderHourChart(calls) {
  const counts = Array.from({ length: 12 }, (_, index) => {
    const hour = index + 7;
    return {
      hour,
      label: hour === 12 ? "12p" : hour > 12 ? `${hour - 12}p` : `${hour}a`,
      count: calls.filter((call) => call.calledAt.getHours() === hour).length,
    };
  });
  const max = Math.max(1, ...counts.map((item) => item.count));
  els.hourChart.innerHTML = counts.map((item) => `
    <div class="hour-bar" title="${item.count} calls at ${item.label}">
      <div class="hour-value">${item.count}</div>
      <div class="hour-fill" style="height: ${Math.max(3, (item.count / max) * 170)}px"></div>
      <div class="hour-label">${item.label}</div>
    </div>
  `).join("");
}

function renderRankList(element, entries) {
  if (!entries.length) {
    element.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }
  const max = Math.max(...entries.map(([, count]) => count));
  element.innerHTML = entries.map(([name, count]) => `
    <div class="rank-row">
      <div class="rank-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="rank-count">${count}</div>
      <div class="rank-meter"><span style="width: ${(count / max) * 100}%"></span></div>
    </div>
  `).join("");
}

function renderLog(calls) {
  els.callLog.innerHTML = calls.slice(0, 200).map((call) => `
    <tr>
      <td>${call.calledAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
      <td>${escapeHtml(call.agent)}</td>
      <td>${escapeHtml(call.shop)}</td>
      <td>${escapeHtml(call.task)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="empty">No calls in this range.</td></tr>`;
}

function render() {
  const calls = filteredCalls();
  const shops = countBy(calls, "shop");
  const tasks = countBy(calls, "task");
  const hourCounts = countBy(calls.map((call) => ({ hour: call.calledAt.getHours() })), "hour");
  const busiest = topEntries(hourCounts, 1)[0];
  const { start, end, period } = getRange();

  els.totalCalls.textContent = calls.length.toLocaleString();
  els.shopCount.textContent = shops.size.toLocaleString();
  els.taskCount.textContent = tasks.size.toLocaleString();
  els.busiestHour.textContent = busiest ? `${formatHour(Number(busiest[0]))}` : "--";
  els.rangeLabel.textContent = `${start.toLocaleDateString()} - ${new Date(end - 1).toLocaleDateString()}`;
  els.shopLabel.textContent = `${period} view`;
  els.taskLabel.textContent = `${period} view`;
  els.logLabel.textContent = `${Math.min(calls.length, 200)} shown`;

  renderHourChart(calls);
  renderRankList(els.shopChart, topEntries(shops));
  renderRankList(els.taskChart, topEntries(tasks));
  renderLog(calls);
}

function formatHour(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

async function loadSheet() {
  setStatus("Loading Google Sheet...");
  const response = await fetch(`${SHEET_URL}&cacheBust=${Date.now()}`);
  if (!response.ok) throw new Error(`Google Sheet returned ${response.status}`);
  const csv = await response.text();
  const parsed = parseCsv(csv);
  state.rows = rowsToObjects(parsed);
  state.columns = inferColumns(state.rows);
  state.calls = buildCalls(state.rows, state.columns);

  const missing = ["agent", "shop", "task"].filter((key) => !state.columns[key]);
  if (!state.calls.length) {
    throw new Error("No dated call rows were found. Check that the sheet has a Date, Time, or Timestamp column.");
  }

  populateAgents();
  if (!els.dateFilter.value) {
    els.dateFilter.value = formatDateInput(state.calls[0].calledAt);
  }

  const mapped = Object.entries(state.columns)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  setStatus(`${state.calls.length.toLocaleString()} calls loaded. Columns mapped: ${mapped}${missing.length ? `. Missing optional grouping columns: ${missing.join(", ")}.` : "."}`);
  render();
}

els.refreshButton.addEventListener("click", () => loadSheet().catch((error) => setStatus(error.message, true)));
els.agentFilter.addEventListener("change", render);
els.periodFilter.addEventListener("change", render);
els.dateFilter.addEventListener("change", render);

loadSheet().catch((error) => {
  setStatus(`${error.message} If the sheet is private, publish it or share it so viewers can read it.`, true);
});
