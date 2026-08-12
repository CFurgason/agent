const SHEET_ID = "19NMJyjtPNBEqm_STpbVeO69UbymsL7F78h5uX_7xeE8";
const SHEET_GID = "0";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const state = {
  rows: [],
  calls: [],
  columns: {},
  period: "week",
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  agentFilter: document.querySelector("#agentFilter"),
  periodButtons: [...document.querySelectorAll(".period-button")],
  startDateFilter: document.querySelector("#startDateFilter"),
  endDateFilter: document.querySelector("#endDateFilter"),
  statusPanel: document.querySelector("#statusPanel"),
  totalCalls: document.querySelector("#totalCalls"),
  shopCount: document.querySelector("#shopCount"),
  taskCount: document.querySelector("#taskCount"),
  busiestHour: document.querySelector("#busiestHour"),
  rangeLabel: document.querySelector("#rangeLabel"),
  volumeLabel: document.querySelector("#volumeLabel"),
  shopLabel: document.querySelector("#shopLabel"),
  taskLabel: document.querySelector("#taskLabel"),
  logLabel: document.querySelector("#logLabel"),
  hourChart: document.querySelector("#hourChart"),
  volumeBreakdown: document.querySelector("#volumeBreakdown"),
  shopChart: document.querySelector("#shopChart"),
  taskChart: document.querySelector("#taskChart"),
  callLog: document.querySelector("#callLog"),
};

const columnAliases = {
  agent: ["agent", "caller", "call agent", "bdc agent", "employee", "rep", "representative"],
  shop: ["shop", "store", "location", "called shop", "shop called", "company", "business"],
  task: ["task type", "call type", "activity type", "task", "reason", "category", "purpose", "campaign", "type"],
  timestamp: ["timestamp", "datetime", "date time", "created at", "call datetime", "call date time"],
  date: ["date", "call date", "day"],
  time: ["time", "call time", "start time"],
};

const blockedGroupingHeaders = ["id", "key", "number", "num", "phone", "mobile", "cell", "zip"];
const knownTaskValues = [
  "service overdue",
  "returning new customer",
  "new customer",
  "appointment reminder",
  "declined service",
  "follow up",
  "follow-up",
];

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

function textValueScore(rows, header) {
  const values = rows
    .map((row) => String(row[header] || "").trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!values.length) return 0;

  const textValues = values.filter((value) => /[a-zA-Z]/.test(value));
  const uniqueValues = new Set(values.map((value) => value.toLowerCase()));
  return (textValues.length / values.length) * 10 + uniqueValues.size / values.length;
}

function headerPenalty(header) {
  const normalized = normalizeHeader(header);
  return blockedGroupingHeaders.some((blocked) => normalized === blocked || normalized.endsWith(` ${blocked}`))
    ? -100
    : 0;
}

function findColumn(headers, aliases) {
  const normalized = headers.map((header) => [header, normalizeHeader(header)]);
  return normalized.find(([, header]) => aliases.includes(header))?.[0]
    || normalized.find(([, header]) => aliases.some((alias) => header.includes(alias)))?.[0]
    || null;
}

function findTextColumn(rows, aliases) {
  const headers = Object.keys(rows[0] || {});
  const normalized = headers.map((header) => [header, normalizeHeader(header)]);
  const candidates = normalized
    .filter(([, header]) => aliases.includes(header) || aliases.some((alias) => header.includes(alias)))
    .map(([header, normalizedHeader]) => {
      const exactScore = aliases.includes(normalizedHeader) ? 20 : 0;
      const priorityScore = Math.max(0, aliases.length - aliases.findIndex((alias) => normalizedHeader.includes(alias)));
      return {
        header,
        score: exactScore + priorityScore + textValueScore(rows, header) + headerPenalty(header),
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.score > 0 ? candidates[0].header : null;
}

function findKnownTaskColumn(rows) {
  const headers = Object.keys(rows[0] || {});
  const candidates = headers
    .map((header) => {
      const values = rows
        .map((row) => String(row[header] || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
      const knownMatches = values.filter((value) => knownTaskValues.some((task) => value.includes(task))).length;
      return {
        header,
        score: knownMatches * 25 + textValueScore(rows, header) + headerPenalty(header),
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.score > 20 ? candidates[0].header : null;
}

function inferColumns(rows) {
  const headers = Object.keys(rows[0] || {});
  const columns = Object.fromEntries(
    Object.entries(columnAliases).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  );
  columns.task = findTextColumn(rows, columnAliases.task) || findKnownTaskColumn(rows) || columns.task;
  return columns;
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  const parsed = value ? new Date(`${value}T00:00:00`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
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

function getPresetRange(period, selectedDate) {
  const selected = new Date(selectedDate);
  const start = period === "month" ? startOfMonth(selected) : period === "week" ? startOfWeek(selected) : selected;
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  else if (period === "week") end.setDate(end.getDate() + 7);
  else end.setDate(end.getDate() + 1);
  return { start, end };
}

function setDateInputs(start, end) {
  els.startDateFilter.value = formatDateInput(start);
  els.endDateFilter.value = formatDateInput(new Date(end - 1));
}

function setActivePeriod(period) {
  state.period = period;
  els.periodButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.period === period);
  });
}

function applyPreset(period, selectedDate = parseDateInput(els.startDateFilter.value) || new Date()) {
  const { start, end } = getPresetRange(period, selectedDate);
  setActivePeriod(period);
  setDateInputs(start, end);
  render();
}

function getRange() {
  let start = parseDateInput(els.startDateFilter.value) || new Date();
  let selectedEnd = parseDateInput(els.endDateFilter.value) || start;
  if (selectedEnd < start) {
    [start, selectedEnd] = [selectedEnd, start];
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(selectedEnd);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const period = state.period;
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

function renderVolumeBreakdown(calls) {
  const buckets = Array.from({ length: 8 }, (_, index) => {
    const startHour = index + 8;
    const endHour = startHour + 1;
    const count = calls.filter((call) => call.calledAt.getHours() === startHour).length;
    return {
      label: `${formatHour(startHour)} - ${formatHour(endHour)}`,
      count,
    };
  });
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  els.volumeBreakdown.innerHTML = buckets.map((bucket) => `
    <div class="volume-row">
      <div class="volume-time">${bucket.label}</div>
      <div class="volume-meter" aria-hidden="true"><span style="width: ${(bucket.count / max) * 100}%"></span></div>
      <div class="volume-count">${bucket.count}</div>
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
  const periodLabel = period === "custom" ? "custom range" : `${period} view`;

  els.totalCalls.textContent = calls.length.toLocaleString();
  els.shopCount.textContent = shops.size.toLocaleString();
  els.taskCount.textContent = tasks.size.toLocaleString();
  els.busiestHour.textContent = busiest ? `${formatHour(Number(busiest[0]))}` : "--";
  els.rangeLabel.textContent = `${start.toLocaleDateString()} - ${new Date(end - 1).toLocaleDateString()}`;
  els.volumeLabel.textContent = "8 AM - 4 PM";
  els.shopLabel.textContent = periodLabel;
  els.taskLabel.textContent = periodLabel;
  els.logLabel.textContent = `${Math.min(calls.length, 200)} shown`;

  renderHourChart(calls);
  renderVolumeBreakdown(calls);
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
  if (!els.startDateFilter.value || !els.endDateFilter.value) {
    const { start, end } = getPresetRange(state.period, state.calls[0].calledAt);
    setDateInputs(start, end);
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
els.periodButtons.forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.period));
});
els.startDateFilter.addEventListener("change", () => {
  setActivePeriod("custom");
  render();
});
els.endDateFilter.addEventListener("change", () => {
  setActivePeriod("custom");
  render();
});

loadSheet().catch((error) => {
  setStatus(`${error.message} If the sheet is private, publish it or share it so viewers can read it.`, true);
});
