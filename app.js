const SHEET_ID = "19NMJyjtPNBEqm_STpbVeO69UbymsL7F78h5uX_7xeE8";
const SHEET_GID = "0";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const state = {
  rows: [],
  calls: [],
  columns: {},
  period: "week",
  compareAgents: [],
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
  topShop: document.querySelector("#topShop"),
  rangeLabel: document.querySelector("#rangeLabel"),
  volumeLabel: document.querySelector("#volumeLabel"),
  volumeShopFilter: document.querySelector("#volumeShopFilter"),
  shopLabel: document.querySelector("#shopLabel"),
  taskLabel: document.querySelector("#taskLabel"),
  taskHourLabel: document.querySelector("#taskHourLabel"),
  shopHourLabel: document.querySelector("#shopHourLabel"),
  volumeBreakdown: document.querySelector("#volumeBreakdown"),
  shopChart: document.querySelector("#shopChart"),
  taskChart: document.querySelector("#taskChart"),
  taskHourChart: document.querySelector("#taskHourChart"),
  shopHourChart: document.querySelector("#shopHourChart"),
  compareAgentChoices: document.querySelector("#compareAgentChoices"),
  compareSummary: document.querySelector("#compareSummary"),
  compareTable: document.querySelector("#compareTable"),
  compareShopMatrix: document.querySelector("#compareShopMatrix"),
  compareTaskMatrix: document.querySelector("#compareTaskMatrix"),
};

let taskHourTooltip = null;

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

function callsForSelectedAgent() {
  const agent = els.agentFilter?.value || "all";
  return state.calls.filter((call) => agent === "all" || call.agent === agent);
}

function callsInCurrentRange(calls) {
  const { start, end } = getRange();
  return calls.filter((call) => call.calledAt >= start && call.calledAt < end);
}

function getPresetAnchor(period) {
  const selectedStart = parseDateInput(els.startDateFilter.value);
  if (period !== "day") return selectedStart || state.calls[0]?.calledAt || new Date();

  const scopedCalls = callsForSelectedAgent();
  return callsInCurrentRange(scopedCalls)[0]?.calledAt
    || scopedCalls[0]?.calledAt
    || selectedStart
    || new Date();
}

function applyPreset(period, selectedDate = getPresetAnchor(period)) {
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

function removeLegacyCallLog() {
  document.querySelector("#callLog")?.closest(".panel")?.remove();
  document.querySelector("#logLabel")?.closest(".panel")?.remove();
}

function populateAgents() {
  const agents = [...new Set(state.calls.map((call) => call.agent))].sort((a, b) => a.localeCompare(b));
  if (els.agentFilter) {
    els.agentFilter.innerHTML = `<option value="all">All agents</option>${agents
      .map((agent) => `<option value="${escapeHtml(agent)}">${escapeHtml(agent)}</option>`)
      .join("")}`;
  }
  if (els.compareAgentChoices) {
    const selected = state.compareAgents.length ? new Set(state.compareAgents) : new Set(agents.slice(0, 3));
    els.compareAgentChoices.innerHTML = agents
      .map((agent) => `
        <label class="check-row">
          <input type="checkbox" value="${escapeHtml(agent)}" ${selected.has(agent) ? "checked" : ""} />
          <span>${escapeHtml(agent)}</span>
        </label>
      `)
      .join("");
    state.compareAgents = [...els.compareAgentChoices.querySelectorAll("input:checked")].map((input) => input.value);
  }
}

function populateVolumeShops(calls) {
  if (!els.volumeShopFilter) return;
  const selected = els.volumeShopFilter.value || "all";
  const shops = [...new Set(calls.map((call) => call.shop))].sort((a, b) => a.localeCompare(b));
  els.volumeShopFilter.innerHTML = `<option value="all">All shops</option>${shops
    .map((shop) => `<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`)
    .join("")}`;
  els.volumeShopFilter.value = shops.includes(selected) ? selected : "all";
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
  const agent = els.agentFilter?.value || "all";
  return state.calls.filter((call) => {
    const inDate = call.calledAt >= start && call.calledAt < end;
    const inAgent = agent === "all" || call.agent === agent;
    return inDate && inAgent;
  });
}

function renderRankList(element, entries) {
  if (!element) return;
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

function formatHour(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function getVolumeCalls(calls) {
  const shop = els.volumeShopFilter?.value || "all";
  return calls.filter((call) => {
    const inShop = shop === "all" || call.shop === shop;
    return inShop;
  });
}

function volumeFilterLabel(calls) {
  const agent = els.agentFilter?.value || "all";
  const shop = els.volumeShopFilter?.value || "all";
  const agentLabel = agent === "all" ? "all agents" : agent;
  const shopLabel = shop === "all" ? "all shops" : shop;
  const hours = calls.map((call) => call.calledAt.getHours());
  const hourLabel = hours.length
    ? `${formatHour(Math.min(...hours))} - ${formatHour(Math.max(...hours) + 1)}`
    : "no hours";
  return `${calls.length.toLocaleString()} calls, ${hourLabel}, ${agentLabel}, ${shopLabel}`;
}

function renderVolumeBreakdown(calls) {
  if (!els.volumeBreakdown) return;
  const scopedCalls = getVolumeCalls(calls);
  if (!scopedCalls.length) {
    els.volumeBreakdown.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const hours = scopedCalls.map((call) => call.calledAt.getHours());
  const firstHour = Math.min(...hours);
  const lastHour = Math.max(...hours);
  const buckets = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => {
    const startHour = firstHour + index;
    const endHour = startHour + 1;
    const count = scopedCalls.filter((call) => call.calledAt.getHours() === startHour).length;
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

function hourRange(calls) {
  const hours = calls.map((call) => call.calledAt.getHours());
  if (!hours.length) return [];
  const firstHour = Math.min(...hours);
  const lastHour = Math.max(...hours);
  return Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
}

function taskColor(index) {
  return ["#1d4ed8", "#0f5f59", "#a55322", "#6d28d9", "#0e7490", "#946214", "#475569", "#be185d"][index % 8];
}

function renderTaskHourChart(calls) {
  if (!els.taskHourChart) return;
  const scopedCalls = getVolumeCalls(calls);
  const hours = hourRange(scopedCalls);
  const tasks = topEntries(countBy(scopedCalls, "task"), 6).map(([task]) => task);

  if (!scopedCalls.length || !hours.length || !tasks.length) {
    els.taskHourChart.innerHTML = `<p class="empty">No calls in this range.</p>`;
    if (els.taskHourLabel) els.taskHourLabel.textContent = volumeFilterLabel(scopedCalls);
    return;
  }

  const totals = hours.map((hour) => scopedCalls.filter((call) => call.calledAt.getHours() === hour).length);
  const max = Math.max(1, ...totals);
  const legend = tasks.map((task, index) => `
    <div class="cluster-legend-item">
      <span style="background: ${taskColor(index)}"></span>
      <strong title="${escapeHtml(task)}">${escapeHtml(task)}</strong>
    </div>
  `).join("");

  const groups = hours.map((hour) => {
    const total = scopedCalls.filter((call) => call.calledAt.getHours() === hour).length;
    const segments = tasks.map((task, index) => {
      const count = scopedCalls.filter((call) => call.calledAt.getHours() === hour && call.task === task).length;
      if (!count) return "";
      const width = Math.max(2, (count / total) * 100);
      return `
        <span
          class="cluster-segment"
          style="width: ${width}%; background: ${taskColor(index)}"
          data-tooltip-title="${escapeHtml(task)}"
          data-tooltip-count="${count.toLocaleString()}"
        ></span>
      `;
    }).join("");
    const totalWidth = Math.max(2, (total / max) * 100);
    return `
      <div class="cluster-row">
        <div class="cluster-hour">${formatHour(hour)} - ${formatHour(hour + 1)}</div>
        <div class="cluster-track">
          <div class="cluster-stack" style="width: ${totalWidth}%">${segments}</div>
        </div>
        <div class="cluster-total">${total.toLocaleString()}</div>
      </div>
    `;
  }).join("");

  els.taskHourChart.innerHTML = `<div class="cluster-legend">${legend}</div><div class="cluster-plot horizontal">${groups}</div>`;
  if (els.taskHourLabel) els.taskHourLabel.textContent = volumeFilterLabel(scopedCalls);
}

function renderShopHourChart(calls) {
  if (!els.shopHourChart) return;
  const scopedCalls = getVolumeCalls(calls);
  const hours = hourRange(scopedCalls);
  const shops = topEntries(countBy(scopedCalls, "shop"), 8).map(([shop]) => shop);

  if (!scopedCalls.length || !hours.length || !shops.length) {
    els.shopHourChart.innerHTML = `<p class="empty">No calls in this range.</p>`;
    if (els.shopHourLabel) els.shopHourLabel.textContent = volumeFilterLabel(scopedCalls);
    return;
  }

  const totals = hours.map((hour) => scopedCalls.filter((call) => call.calledAt.getHours() === hour).length);
  const max = Math.max(1, ...totals);
  const legend = shops.map((shop, index) => `
    <div class="cluster-legend-item">
      <span style="background: ${taskColor(index)}"></span>
      <strong title="${escapeHtml(shop)}">${escapeHtml(shop)}</strong>
    </div>
  `).join("");

  const groups = hours.map((hour) => {
    const total = scopedCalls.filter((call) => call.calledAt.getHours() === hour).length;
    const segments = shops.map((shop, index) => {
      const count = scopedCalls.filter((call) => call.calledAt.getHours() === hour && call.shop === shop).length;
      if (!count) return "";
      const width = Math.max(2, (count / total) * 100);
      return `
        <span
          class="cluster-segment"
          style="width: ${width}%; background: ${taskColor(index)}"
          data-tooltip-title="${escapeHtml(shop)}"
          data-tooltip-count="${count.toLocaleString()}"
        ></span>
      `;
    }).join("");
    const totalWidth = Math.max(2, (total / max) * 100);
    return `
      <div class="cluster-row">
        <div class="cluster-hour">${formatHour(hour)} - ${formatHour(hour + 1)}</div>
        <div class="cluster-track">
          <div class="cluster-stack" style="width: ${totalWidth}%">${segments}</div>
        </div>
        <div class="cluster-total">${total.toLocaleString()}</div>
      </div>
    `;
  }).join("");

  els.shopHourChart.innerHTML = `<div class="cluster-legend">${legend}</div><div class="cluster-plot horizontal">${groups}</div>`;
  if (els.shopHourLabel) els.shopHourLabel.textContent = volumeFilterLabel(scopedCalls);
}

function showTaskHourTooltip(segment, event) {
  if (!taskHourTooltip) {
    taskHourTooltip = document.createElement("div");
    taskHourTooltip.className = "cluster-tooltip";
    taskHourTooltip.setAttribute("role", "tooltip");
    document.body.appendChild(taskHourTooltip);
  }

  const title = segment.dataset.tooltipTitle || "";
  const count = segment.dataset.tooltipCount || "0";
  taskHourTooltip.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${count} phone calls</span>
  `;
  taskHourTooltip.classList.add("visible");
  moveTaskHourTooltip(event);
}

function moveTaskHourTooltip(event) {
  if (!taskHourTooltip) return;
  const margin = 14;
  const tooltipRect = taskHourTooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - tooltipRect.width - margin, event.clientX + margin);
  const top = Math.max(margin, event.clientY - tooltipRect.height - margin);
  taskHourTooltip.style.left = `${Math.max(margin, left)}px`;
  taskHourTooltip.style.top = `${top}px`;
}

function hideTaskHourTooltip() {
  taskHourTooltip?.classList.remove("visible");
}

function renderDashboard() {
  const calls = filteredCalls();
  const shops = countBy(calls, "shop");
  const tasks = countBy(calls, "task");
  const topShop = topEntries(shops, 1)[0];
  const { start, end, period } = getRange();
  const periodLabel = period === "custom" ? "custom range" : `${period} view`;

  if (els.totalCalls) els.totalCalls.textContent = calls.length.toLocaleString();
  if (els.shopCount) els.shopCount.textContent = shops.size.toLocaleString();
  if (els.taskCount) els.taskCount.textContent = tasks.size.toLocaleString();
  if (els.topShop) els.topShop.textContent = topShop ? topShop[0] : "--";
  if (els.rangeLabel) els.rangeLabel.textContent = `${start.toLocaleDateString()} - ${new Date(end - 1).toLocaleDateString()}`;
  populateVolumeShops(calls);
  if (els.volumeLabel) els.volumeLabel.textContent = volumeFilterLabel(getVolumeCalls(calls));
  if (els.shopLabel) els.shopLabel.textContent = periodLabel;
  if (els.taskLabel) els.taskLabel.textContent = periodLabel;

  renderRankList(els.shopChart, topEntries(shops));
  renderVolumeBreakdown(calls);
  renderRankList(els.taskChart, topEntries(tasks));
  renderTaskHourChart(calls);
  renderShopHourChart(calls);
}

function agentMetrics(calls, agent) {
  const agentCalls = calls.filter((call) => call.agent === agent);
  const shops = countBy(agentCalls, "shop");
  const tasks = countBy(agentCalls, "task");
  return {
    agent,
    calls: agentCalls.length,
    shops: shops.size,
    tasks: tasks.size,
    topShop: topEntries(shops, 1)[0]?.[0] || "--",
    topTask: topEntries(tasks, 1)[0]?.[0] || "--",
  };
}

function renderCompareSummary(metrics) {
  if (!els.compareSummary) return;
  const leader = [...metrics].sort((a, b) => b.calls - a.calls || a.agent.localeCompare(b.agent))[0];
  const totalCalls = metrics.reduce((sum, metric) => sum + metric.calls, 0);
  const totalShops = new Set(filteredCalls()
    .filter((call) => state.compareAgents.includes(call.agent))
    .map((call) => call.shop)).size;

  els.compareSummary.innerHTML = `
    <article>
      <span>Agents selected</span>
      <strong>${metrics.length}</strong>
    </article>
    <article>
      <span>Combined calls</span>
      <strong>${totalCalls.toLocaleString()}</strong>
    </article>
    <article>
      <span>Shops reached</span>
      <strong>${totalShops.toLocaleString()}</strong>
    </article>
    <article>
      <span>Call leader</span>
      <strong>${leader ? escapeHtml(leader.agent) : "--"}</strong>
    </article>
  `;
}

function renderCompareTable(metrics) {
  if (!els.compareTable) return;
  els.compareTable.innerHTML = metrics.map((metric) => `
    <tr>
      <td>${escapeHtml(metric.agent)}</td>
      <td>${metric.calls.toLocaleString()}</td>
      <td>${metric.shops.toLocaleString()}</td>
      <td>${metric.tasks.toLocaleString()}</td>
      <td>${escapeHtml(metric.topShop)}</td>
      <td>${escapeHtml(metric.topTask)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty">Select two or more agents to compare.</td></tr>`;
}

function renderMatrix(element, calls, groupKey) {
  if (!element) return;
  const groups = topEntries(countBy(calls, groupKey), 8).map(([name]) => name);
  if (!state.compareAgents.length || !groups.length) {
    element.innerHTML = `<p class="empty">No comparison data in this range.</p>`;
    return;
  }

  const rows = groups.map((group) => {
    const cells = state.compareAgents.map((agent) => {
      const count = calls.filter((call) => call.agent === agent && call[groupKey] === group).length;
      return `<td>${count.toLocaleString()}</td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(group)}</th>${cells}</tr>`;
  }).join("");

  element.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${groupKey === "shop" ? "Shop" : "Task type"}</th>
          ${state.compareAgents.map((agent) => `<th>${escapeHtml(agent)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderComparison() {
  if (!els.compareAgentChoices) return;
  state.compareAgents = [...els.compareAgentChoices.querySelectorAll("input:checked")].map((input) => input.value);
  const calls = filteredCalls().filter((call) => state.compareAgents.includes(call.agent));
  const metrics = state.compareAgents.map((agent) => agentMetrics(calls, agent));

  renderCompareSummary(metrics);
  renderCompareTable(metrics);
  renderMatrix(els.compareShopMatrix, calls, "shop");
  renderMatrix(els.compareTaskMatrix, calls, "task");
}

function render() {
  removeLegacyCallLog();
  renderDashboard();
  renderComparison();
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

els.refreshButton?.addEventListener("click", () => loadSheet().catch((error) => setStatus(error.message, true)));
els.agentFilter?.addEventListener("change", render);
els.volumeShopFilter?.addEventListener("change", render);
els.compareAgentChoices?.addEventListener("change", render);
els.periodButtons.forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.period));
});
els.startDateFilter?.addEventListener("change", () => {
  setActivePeriod("custom");
  render();
});
els.endDateFilter?.addEventListener("change", () => {
  setActivePeriod("custom");
  render();
});
["taskHourChart", "shopHourChart"].forEach((chartKey) => {
  els[chartKey]?.addEventListener("pointerover", (event) => {
    const segment = event.target.closest(".cluster-segment");
    if (segment) showTaskHourTooltip(segment, event);
  });
  els[chartKey]?.addEventListener("pointermove", (event) => {
    if (event.target.closest(".cluster-segment")) moveTaskHourTooltip(event);
  });
  els[chartKey]?.addEventListener("pointerout", (event) => {
    if (event.target.closest(".cluster-segment")) hideTaskHourTooltip();
  });
});

loadSheet().catch((error) => {
  setStatus(`${error.message} If the sheet is private, publish it or share it so viewers can read it.`, true);
});
