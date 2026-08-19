const SHEET_ID = "19NMJyjtPNBEqm_STpbVeO69UbymsL7F78h5uX_7xeE8";
const SHEET_GID = "0";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const state = {
  rows: [],
  calls: [],
  columns: {},
  period: "week",
  breakdown: "hourly",
  compareAgents: [],
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  agentFilter: document.querySelector("#agentFilter"),
  periodButtons: [...document.querySelectorAll(".period-button")],
  breakdownButtons: [...document.querySelectorAll(".breakdown-button")],
  startDateFilter: document.querySelector("#startDateFilter"),
  endDateFilter: document.querySelector("#endDateFilter"),
  statusPanel: document.querySelector("#statusPanel"),
  totalCalls: document.querySelector("#totalCalls"),
  agentCount: document.querySelector("#agentCount"),
  shopCount: document.querySelector("#shopCount"),
  taskCount: document.querySelector("#taskCount"),
  topShop: document.querySelector("#topShop"),
  topPair: document.querySelector("#topPair"),
  rangeLabel: document.querySelector("#rangeLabel"),
  matrixLabel: document.querySelector("#matrixLabel"),
  pairLabel: document.querySelector("#pairLabel"),
  agentFlowTitle: document.querySelector("#agentFlowTitle"),
  agentFlowLabel: document.querySelector("#agentFlowLabel"),
  timeBreakdownTitle: document.querySelector("#timeBreakdownTitle"),
  timeBreakdownLabel: document.querySelector("#timeBreakdownLabel"),
  volumeLabel: document.querySelector("#volumeLabel"),
  shopLabel: document.querySelector("#shopLabel"),
  taskLabel: document.querySelector("#taskLabel"),
  taskHourLabel: document.querySelector("#taskHourLabel"),
  shopHourLabel: document.querySelector("#shopHourLabel"),
  volumeBreakdown: document.querySelector("#volumeBreakdown"),
  shopChart: document.querySelector("#shopChart"),
  taskChart: document.querySelector("#taskChart"),
  taskHourChart: document.querySelector("#taskHourChart"),
  shopHourChart: document.querySelector("#shopHourChart"),
  agentShopMatrix: document.querySelector("#agentShopMatrix"),
  agentShopPairs: document.querySelector("#agentShopPairs"),
  agentFlow: document.querySelector("#agentFlow"),
  timeBreakdown: document.querySelector("#timeBreakdown"),
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
    .replace(/[_/-]+/g, " ")
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

function setActiveBreakdown(breakdown) {
  state.breakdown = breakdown;
  els.breakdownButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.breakdown === breakdown);
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
  if (period === "day") return state.calls[0]?.calledAt || selectedStart || new Date();
  return selectedStart || state.calls[0]?.calledAt || new Date();
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

function pairKey(agent, shop) {
  return `${agent}\u0000${shop}`;
}

function splitPairKey(key) {
  const [agent, shop] = key.split("\u0000");
  return { agent, shop };
}

function countPairs(calls) {
  return calls.reduce((map, call) => {
    const key = pairKey(call.agent, call.shop);
    map.set(key, (map.get(key) || 0) + 1);
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

function renderAgentShopMatrix(calls) {
  if (!els.agentShopMatrix) return;
  const agents = topEntries(countBy(calls, "agent"), 12).map(([agent]) => agent);
  const shops = topEntries(countBy(calls, "shop"), 10).map(([shop]) => shop);

  if (!agents.length || !shops.length) {
    els.agentShopMatrix.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const max = Math.max(1, ...agents.flatMap((agent) =>
    shops.map((shop) => calls.filter((call) => call.agent === agent && call.shop === shop).length),
  ));

  const rows = agents.map((agent) => {
    const rowTotal = calls.filter((call) => call.agent === agent).length;
    const cells = shops.map((shop) => {
      const count = calls.filter((call) => call.agent === agent && call.shop === shop).length;
      const intensity = count ? 0.18 + (count / max) * 0.72 : 0;
      return `
        <td class="heat-cell" style="--heat: ${intensity}">
          <span>${count ? count.toLocaleString() : ""}</span>
        </td>
      `;
    }).join("");
    return `
      <tr>
        <th scope="row">${escapeHtml(agent)}<span>${rowTotal.toLocaleString()} calls</span></th>
        ${cells}
      </tr>
    `;
  }).join("");

  els.agentShopMatrix.innerHTML = `
    <table class="heat-table">
      <thead>
        <tr>
          <th>Agent</th>
          ${shops.map((shop) => `<th title="${escapeHtml(shop)}">${escapeHtml(shop)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAgentShopPairs(calls) {
  if (!els.agentShopPairs) return;
  const pairs = topEntries(countPairs(calls), 12);
  if (!pairs.length) {
    els.agentShopPairs.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const max = Math.max(...pairs.map(([, count]) => count));
  els.agentShopPairs.innerHTML = pairs.map(([key, count], index) => {
    const { agent, shop } = splitPairKey(key);
    return `
      <div class="pair-row">
        <div class="pair-rank">${index + 1}</div>
        <div class="pair-copy">
          <strong title="${escapeHtml(agent)}">${escapeHtml(agent)}</strong>
          <span title="${escapeHtml(shop)}">${escapeHtml(shop)}</span>
        </div>
        <div class="pair-count">${count.toLocaleString()}</div>
        <div class="pair-meter"><span style="width: ${(count / max) * 100}%"></span></div>
      </div>
    `;
  }).join("");
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function bucketStart(date, breakdown) {
  if (breakdown === "weekly") return startOfWeek(date);
  if (breakdown === "daily") return startOfDay(date);
  const result = new Date(date);
  result.setMinutes(0, 0, 0);
  return result;
}

function bucketLabel(date, breakdown) {
  if (breakdown === "weekly") {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return `${date.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }
  if (breakdown === "daily") return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${formatHour(date.getHours())} - ${formatHour(date.getHours() + 1)}`;
}

function formatFlowEndpoint(date) {
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${formatHour(date.getHours())}`;
}

function bucketCalls(calls, breakdown) {
  const buckets = calls.reduce((map, call) => {
    const start = bucketStart(call.calledAt, breakdown);
    const key = start.toISOString();
    if (!map.has(key)) map.set(key, { start, calls: [] });
    map.get(key).calls.push(call);
    return map;
  }, new Map());
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}

function bucketSequence(calls, breakdown) {
  const bucketMap = bucketCalls(calls, breakdown);
  return bucketMap.map((bucket) => bucket.start);
}

function bucketKey(date, breakdown) {
  return bucketStart(date, breakdown).toISOString();
}

function renderAgentShopCoverage(calls) {
  const agents = topEntries(countBy(calls, "agent"), 20).map(([agent]) => agent);
  return agents.map((agent) => {
    const agentCalls = calls.filter((call) => call.agent === agent);
    const shops = topEntries(countBy(agentCalls, "shop"), 50);
    return `
      <div class="coverage-agent">
        <strong>${escapeHtml(agent)}</strong>
        <div class="coverage-shops">
          ${shops.map(([shop, count]) => `
            <span title="${escapeHtml(shop)}">${escapeHtml(shop)} <b>${count.toLocaleString()}</b></span>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderAgentFlow(calls) {
  if (!els.agentFlow) return;
  const agents = topEntries(countBy(calls, "agent"), 12).map(([agent]) => agent);
  const buckets = bucketSequence(calls, state.breakdown);
  const title = state.breakdown === "weekly" ? "Weekly agent call flow" : state.breakdown === "daily" ? "Daily agent call flow" : "Hourly agent call flow";
  if (els.agentFlowTitle) els.agentFlowTitle.textContent = title;

  if (!agents.length || !buckets.length) {
    els.agentFlow.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const rows = agents.map((agent) => {
    const agentCalls = calls
      .filter((call) => call.agent === agent)
      .sort((a, b) => a.calledAt - b.calledAt);
    const firstCall = agentCalls[0];
    const lastCall = agentCalls[agentCalls.length - 1];
    const cells = buckets.map((bucket) => {
      const key = bucket.toISOString();
      const bucketCallsForAgent = agentCalls.filter((call) => bucketKey(call.calledAt, state.breakdown) === key);
      if (!bucketCallsForAgent.length) return `<div class="flow-cell empty-cell" aria-label="No calls"></div>`;

      const shopVisits = topEntries(countBy(bucketCallsForAgent, "shop"), 8);
      return `
        <div class="flow-cell active-cell">
          <div class="flow-count">${bucketCallsForAgent.length.toLocaleString()}</div>
          <div class="flow-shops">
            ${shopVisits.map(([shop, count]) => `
              <span title="${escapeHtml(shop)}">${escapeHtml(shop)}${count > 1 ? ` <b>${count.toLocaleString()}</b>` : ""}</span>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="flow-row">
        <div class="flow-agent">
          <strong title="${escapeHtml(agent)}">${escapeHtml(agent)}</strong>
          <span>${agentCalls.length.toLocaleString()} calls</span>
          <small>${formatFlowEndpoint(firstCall.calledAt)} - ${formatFlowEndpoint(lastCall.calledAt)}</small>
        </div>
        <div class="flow-track" style="grid-template-columns: repeat(${buckets.length}, minmax(128px, 1fr));">
          ${cells}
        </div>
      </div>
    `;
  }).join("");

  els.agentFlow.innerHTML = `
    <div class="flow-header" style="grid-template-columns: 190px repeat(${buckets.length}, minmax(128px, 1fr));">
      <div></div>
      ${buckets.map((bucket) => `<span>${bucketLabel(bucket, state.breakdown)}</span>`).join("")}
    </div>
    <div class="flow-body">${rows}</div>
  `;
}

function renderTimeBreakdown(calls) {
  if (!els.timeBreakdown) return;
  const buckets = bucketCalls(calls, state.breakdown);
  const title = state.breakdown === "weekly" ? "Weekly activity" : state.breakdown === "daily" ? "Daily activity" : "Hourly activity";
  if (els.timeBreakdownTitle) els.timeBreakdownTitle.textContent = title;

  if (!buckets.length) {
    els.timeBreakdown.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const rows = buckets.map((bucket) => {
    const agents = countBy(bucket.calls, "agent");
    const pairs = countPairs(bucket.calls);
    const topAgent = topEntries(agents, 1)[0];
    const topPairEntry = topEntries(pairs, 1)[0];
    const topPairValue = topPairEntry ? splitPairKey(topPairEntry[0]) : null;
    return `
      <tr>
        <th scope="row">${bucketLabel(bucket.start, state.breakdown)}</th>
        <td>${bucket.calls.length.toLocaleString()}</td>
        <td>${topAgent ? `${escapeHtml(topAgent[0])} <span>${topAgent[1].toLocaleString()}</span>` : "--"}</td>
        <td class="coverage-cell">${renderAgentShopCoverage(bucket.calls)}</td>
        <td>${topPairValue ? `${escapeHtml(topPairValue.agent)} / ${escapeHtml(topPairValue.shop)} <span>${topPairEntry[1].toLocaleString()}</span>` : "--"}</td>
      </tr>
    `;
  }).join("");

  els.timeBreakdown.innerHTML = `
    <table class="activity-table">
      <thead>
        <tr>
          <th>Window</th>
          <th>Calls</th>
          <th>Top agent</th>
          <th>Agents and shops called</th>
          <th>Top agent/shop</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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

function renderColumnChart(element, entries) {
  if (!element) return;
  if (!entries.length) {
    element.innerHTML = `<p class="empty">No calls in this range.</p>`;
    return;
  }

  const max = Math.max(...entries.map(([, count]) => count));
  element.innerHTML = `
    <div class="column-chart">
      ${entries.map(([name, count], index) => {
        const height = Math.max(6, (count / max) * 100);
        return `
          <div class="column-item" title="${escapeHtml(name)}: ${count.toLocaleString()} phone calls">
            <div class="column-value">${count.toLocaleString()}</div>
            <div class="column-track" aria-hidden="true">
              <span style="height: ${height}%; background: ${taskColor(index)}"></span>
            </div>
            <div class="column-label">${escapeHtml(name)}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatHour(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function volumeFilterLabel(calls) {
  const agent = els.agentFilter?.value || "all";
  const agentLabel = agent === "all" ? "all agents" : agent;
  const hours = calls.map((call) => call.calledAt.getHours());
  const hourLabel = hours.length
    ? `${formatHour(Math.min(...hours))} - ${formatHour(Math.max(...hours) + 1)}`
    : "no hours";
  return `${calls.length.toLocaleString()} calls, ${hourLabel}, ${agentLabel}`;
}

function renderVolumeBreakdown(calls) {
  if (!els.volumeBreakdown) return;
  const scopedCalls = calls;
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
  return ["#00a884", "#e7a739", "#df654d", "#7f63d9", "#0f766e", "#b45309", "#be3455", "#4761b2"][index % 8];
}

function renderTaskHourChart(calls) {
  if (!els.taskHourChart) return;
  const scopedCalls = calls;
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
  const scopedCalls = calls;
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
  const agents = countBy(calls, "agent");
  const shops = countBy(calls, "shop");
  const tasks = countBy(calls, "task");
  const topShop = topEntries(shops, 1)[0];
  const topPairEntry = topEntries(countPairs(calls), 1)[0];
  const topPair = topPairEntry ? splitPairKey(topPairEntry[0]) : null;
  const { start, end, period } = getRange();
  const periodLabel = period === "custom" ? "custom range" : `${period} view`;
  const rangeText = `${start.toLocaleDateString()} - ${new Date(end - 1).toLocaleDateString()}`;

  if (els.totalCalls) els.totalCalls.textContent = calls.length.toLocaleString();
  if (els.agentCount) els.agentCount.textContent = agents.size.toLocaleString();
  if (els.shopCount) els.shopCount.textContent = shops.size.toLocaleString();
  if (els.taskCount) els.taskCount.textContent = tasks.size.toLocaleString();
  if (els.topShop) els.topShop.textContent = topShop ? topShop[0] : "--";
  if (els.topPair) els.topPair.textContent = topPair ? `${topPair.agent} / ${topPair.shop}` : "--";
  if (els.rangeLabel) els.rangeLabel.textContent = rangeText;
  if (els.matrixLabel) els.matrixLabel.textContent = `${agents.size.toLocaleString()} agents x ${shops.size.toLocaleString()} shops`;
  if (els.pairLabel) els.pairLabel.textContent = rangeText;
  if (els.agentFlowLabel) els.agentFlowLabel.textContent = rangeText;
  if (els.timeBreakdownLabel) els.timeBreakdownLabel.textContent = rangeText;
  if (els.volumeLabel) els.volumeLabel.textContent = volumeFilterLabel(calls);
  if (els.shopLabel) els.shopLabel.textContent = periodLabel;
  if (els.taskLabel) els.taskLabel.textContent = periodLabel;

  renderAgentShopMatrix(calls);
  renderAgentFlow(calls);
  renderAgentShopPairs(calls);
  renderTimeBreakdown(calls);
  renderColumnChart(els.shopChart, topEntries(shops, 10));
  renderVolumeBreakdown(calls);
  renderColumnChart(els.taskChart, topEntries(tasks, 10));
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
  if (state.period !== "custom" || !els.startDateFilter.value || !els.endDateFilter.value) {
    const { start, end } = getPresetRange(state.period, state.calls[0].calledAt);
    setDateInputs(start, end);
  }

  const mapped = Object.entries(state.columns)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  const latestLoaded = state.calls[0].calledAt.toLocaleDateString();
  setStatus(`${state.calls.length.toLocaleString()} calls loaded through ${latestLoaded}. Columns mapped: ${mapped}${missing.length ? `. Missing optional grouping columns: ${missing.join(", ")}.` : "."}`);
  render();
}

els.refreshButton?.addEventListener("click", () => loadSheet().catch((error) => setStatus(error.message, true)));
els.agentFilter?.addEventListener("change", render);
els.compareAgentChoices?.addEventListener("change", render);
els.periodButtons.forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.period));
});
els.breakdownButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveBreakdown(button.dataset.breakdown);
    render();
  });
});
els.startDateFilter?.addEventListener("change", () => {
  if (state.period === "day") {
    els.endDateFilter.value = els.startDateFilter.value;
  }
  setActivePeriod("custom");
  render();
});
els.endDateFilter?.addEventListener("change", () => {
  if (state.period === "day") {
    els.startDateFilter.value = els.endDateFilter.value;
  }
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
