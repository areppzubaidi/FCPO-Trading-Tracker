/* FCPO Journal — single-user, local-first.
 *
 * WHY NO BACKEND (yet). The reference app is Supabase-backed. This one keeps trades in
 * localStorage so it works offline, on a phone, with no auth and nothing to operate. When it needs
 * to be shared or backed up, the export JSON is the migration path — that is why export exists on
 * day one rather than as a feature later.
 *
 * THE MONEY MODEL, stated once so no screen can quietly disagree with another:
 *   FCPO = RM25 per point per lot.
 *   gross   = (exit - entry) * lots * 25, negative for a short that went up
 *   sst     = commission * 8%        (Malaysian service tax on brokerage)
 *   net     = gross - commission - sst
 * Every number on every panel comes from `metrics()`, which comes from `trades`.
 */

const POINT_VALUE = 25;
const SST_RATE = 0.08;
const STORE_KEY = "fcpo.trades.v1";

const TAGS = [
  "VWAP Setup",
  "Stopped out early",
  "Loss Managed",
  "Follow through trade",
  "Scratch exit",
  "Market sluggish",
  "Chased entry",
  "Plan followed",
];

let trades = load();
let filters = { side: "", result: "", q: "" };

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("could not read saved trades", e);
    return [];
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(trades));
}

/* ---------- money ---------- */

function computeTrade(t) {
  const dir = t.side === "short" ? -1 : 1;
  const gross = (Number(t.exit) - Number(t.entry)) * Number(t.lots) * POINT_VALUE * dir;
  const commission = Number(t.commission || 0);
  const sst = commission * SST_RATE;
  const net = gross - commission - sst;
  return { ...t, gross, commission, sst, net };
}

function metrics(list) {
  const rows = list.map(computeTrade).sort((a, b) => (a.date < b.date ? -1 : 1));
  const closed = rows.length;
  const wins = rows.filter((r) => r.net > 0);
  const losses = rows.filter((r) => r.net < 0);

  const grossWin = wins.reduce((s, r) => s + r.net, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.net, 0));
  const net = rows.reduce((s, r) => s + r.net, 0);
  const commission = rows.reduce((s, r) => s + r.commission + r.sst, 0);

  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed ? (wins.length / closed) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const expectancy = closed ? net / closed : 0;

  // streaks, oldest first
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
  for (const r of rows) {
    if (r.net > 0) { winStreak++; lossStreak = 0; maxWin = Math.max(maxWin, winStreak); }
    else if (r.net < 0) { lossStreak++; winStreak = 0; maxLoss = Math.max(maxLoss, lossStreak); }
  }

  // equity curve + max drawdown measured from the running peak
  let cum = 0, peak = 0, maxDD = 0;
  const curve = rows.map((r) => {
    cum += r.net;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    return { date: r.date, value: cum };
  });

  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].map(([k, rs]) => ({
      key: k,
      trades: rs.length,
      net: rs.reduce((s, r) => s + r.net, 0),
      wins: rs.filter((r) => r.net > 0).length,
    }));
  };

  return {
    rows, closed, winRate, grossWin, grossLoss, net, commission,
    avgWin, avgLoss, profitFactor, expectancy, maxWin, maxLoss, maxDD, curve,
    bySide: group((r) => r.side),
    byMonth: group((r) => r.date.slice(0, 7)).sort((a, b) => (a.key < b.key ? -1 : 1)),
    byTag: group((r) => r.tag || "(untagged)").sort((a, b) => a.net - b.net),
  };
}

/* ---------- formatting ---------- */

const rm = (n) =>
  (n < 0 ? "-RM " : "RM ") +
  Math.abs(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- render: dashboard ---------- */

function renderKpis(m) {
  const cards = [
    ["Net P/L", rm(m.net), m.net >= 0 ? "good" : "bad"],
    ["Win rate", m.closed ? m.winRate.toFixed(1) + "%" : "—", m.winRate >= 50 ? "good" : ""],
    ["Profit factor", m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2), m.profitFactor >= 1.5 ? "good" : ""],
    ["Expectancy / trade", m.closed ? rm(m.expectancy) : "—", m.expectancy >= 0 ? "good" : "bad"],
    ["Avg win", rm(m.avgWin), ""],
    ["Avg loss", rm(m.avgLoss), ""],
    ["Max win streak", m.maxWin, ""],
    ["Max loss streak", m.maxLoss, ""],
    ["Max drawdown", rm(m.maxDD), m.maxDD > 0 ? "bad" : ""],
    ["Brokerage + SST", rm(m.commission), ""],
  ];
  document.getElementById("kpis").innerHTML = cards
    .map(([label, value, cls]) => `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`)
    .join("");
}

function renderCurve(m) {
  const svg = document.getElementById("curve");
  const pts = m.curve;
  document.getElementById("curve-note").textContent = pts.length ? `${pts.length} closed trades` : "no trades yet";
  if (!pts.length) { svg.innerHTML = ""; return; }

  const W = 800, H = 220, pad = 8;
  const vals = pts.map((p) => p.value);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const zeroY = y(0);

  svg.innerHTML = `
    <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="axis" />
    <path d="${area}" class="area ${m.net >= 0 ? "up" : "down"}" />
    <path d="${line}" class="line ${m.net >= 0 ? "up" : "down"}" />`;
}

function renderGroupTable(id, groups, headKey) {
  const el = document.getElementById(id);
  if (!groups.length) { el.innerHTML = `<tr><td class="muted">no trades</td></tr>`; return; }
  el.innerHTML =
    `<tr><th>${headKey}</th><th>Trades</th><th>Net</th></tr>` +
    groups.map((g) => `<tr><td>${g.key}</td><td>${g.trades}</td><td class="${g.net >= 0 ? "good" : "bad"}">${rm(g.net)}</td></tr>`).join("");
}

function renderDiscipline(m) {
  const el = document.getElementById("discipline");
  if (!m.byTag.length) { el.innerHTML = `<span class="muted">no tags yet</span>`; return; }
  el.innerHTML = m.byTag
    .map((t) => `<span class="chip ${t.net >= 0 ? "good" : "bad"}">${t.key} · ${t.trades} · ${rm(t.net)}</span>`)
    .join("");
}

/* ---------- render: blotter ---------- */

function renderBlotter(m) {
  const rows = m.rows.filter((r) => {
    if (filters.side && r.side !== filters.side) return false;
    if (filters.result === "win" && r.net <= 0) return false;
    if (filters.result === "loss" && r.net >= 0) return false;
    if (filters.q) {
      const hay = `${r.note || ""} ${r.tag || ""} ${r.contract || ""}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  }).slice().reverse();

  const el = document.getElementById("blotter");
  if (!rows.length) {
    el.innerHTML = `<tr><td class="muted">No trades match the selected filter.</td></tr>`;
  } else {
    el.innerHTML =
      `<tr><th>Date</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>Gross</th><th>Cost</th><th>Net</th><th>Tag</th><th></th></tr>` +
      rows.map((r) => `<tr>
        <td>${r.date}</td>
        <td><span class="side ${r.side}">${r.side}</span></td>
        <td>${r.lots}</td>
        <td>${r.entry}</td>
        <td>${r.exit}</td>
        <td class="${r.gross >= 0 ? "good" : "bad"}">${rm(r.gross)}</td>
        <td class="muted">${rm(r.commission + r.sst)}</td>
        <td class="${r.net >= 0 ? "good" : "bad"}"><strong>${rm(r.net)}</strong></td>
        <td>${r.tag ? `<span class="tag">${r.tag}</span>` : `<span class="muted">—</span>`}</td>
        <td><button class="del" data-id="${r.id}" title="Delete trade">×</button></td>
      </tr>`).join("");
  }
  document.getElementById("blotter-count").textContent = `${rows.length} of ${m.rows.length} trades shown`;
}

/* ---------- render: journal ---------- */

function renderJournal(m) {
  const tagEl = document.getElementById("tag-stats");
  tagEl.innerHTML = m.byTag.length
    ? m.byTag.map((t) => `<span class="chip ${t.net >= 0 ? "good" : "bad"}">${t.key}<b>${rm(t.net)}</b><i>${t.trades} trades · ${Math.round((t.wins / t.trades) * 100)}% win</i></span>`).join("")
    : `<span class="muted">Add trades with tags to see which behaviours pay.</span>`;

  const withNotes = m.rows.filter((r) => r.note && r.note.trim()).slice().reverse();
  document.getElementById("notes").innerHTML = withNotes.length
    ? withNotes.map((r) => `<div class="note">
        <div class="note-head">${r.date} · ${r.side} · <span class="${r.net >= 0 ? "good" : "bad"}">${rm(r.net)}</span>${r.tag ? ` · <span class="tag">${r.tag}</span>` : ""}</div>
        <p>${escapeHtml(r.note)}</p></div>`).join("")
    : `<p class="muted">No notes yet. The blotter is the what; the note is the why.</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- render all ---------- */

function render() {
  const m = metrics(trades);
  renderKpis(m);
  renderCurve(m);
  renderGroupTable("by-side", m.bySide, "Side");
  renderGroupTable("by-month", m.byMonth, "Month");
  renderDiscipline(m);
  renderBlotter(m);
  renderJournal(m);
  document.getElementById("data-note").textContent =
    trades.length ? `${trades.length} trades stored in this browser only. Export before clearing site data.` : "No trades yet.";
}

/* ---------- events ---------- */

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + btn.dataset.view).classList.add("active");
});

document.getElementById("trade-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  trades.push({
    id: "t" + Date.now() + Math.random().toString(36).slice(2, 6),
    date: f.get("date"),
    side: f.get("side"),
    contract: f.get("contract") || "FCPO",
    lots: Number(f.get("lots")),
    entry: Number(f.get("entry")),
    exit: Number(f.get("exit")),
    commission: Number(f.get("commission") || 0),
    tag: (f.get("tag") || "").trim(),
    note: (f.get("note") || "").trim(),
  });
  save();
  e.target.reset();
  render();
});

document.getElementById("blotter").addEventListener("click", (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  trades = trades.filter((t) => t.id !== btn.dataset.id);
  save();
  render();
});

["f-side", "f-result", "f-q"].forEach((id) => {
  document.getElementById(id).addEventListener("input", (e) => {
    filters[id === "f-side" ? "side" : id === "f-result" ? "result" : "q"] = e.target.value;
    renderBlotter(metrics(trades));
  });
});

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById("btn-export-json").addEventListener("click", () =>
  download("fcpo-journal.json", JSON.stringify(trades, null, 2), "application/json"));

document.getElementById("btn-export-csv").addEventListener("click", () => {
  const rows = metrics(trades).rows;
  const head = ["date", "side", "contract", "lots", "entry", "exit", "gross", "commission", "sst", "net", "tag", "note"];
  const csv = [head.join(",")].concat(
    rows.map((r) => head.map((k) => JSON.stringify(k === "note" || k === "tag" ? r[k] || "" : r[k])).join(","))
  ).join("\n");
  download("fcpo-journal.csv", csv, "text/csv");
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("expected an array of trades");
    // ids may collide with existing ones; re-key rather than silently overwriting
    trades = trades.concat(data.map((t) => ({ ...t, id: "t" + Date.now() + Math.random().toString(36).slice(2, 8) })));
    save();
    render();
    document.getElementById("data-note").textContent = `imported ${data.length} trades`;
  } catch (err) {
    document.getElementById("data-note").textContent = "import failed: " + err.message;
  }
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm("Delete every trade in this browser? Export first if you need them.")) return;
  trades = [];
  save();
  render();
});

document.getElementById("btn-demo").addEventListener("click", () => {
  trades = demo();
  save();
  render();
});

function demo() {
  const base = [
    ["2026-10-02", "long", 2, 3810, 3822, 12, "VWAP Setup", "Waited for the pullback to VWAP, entered on the reclaim."],
    ["2026-10-03", "short", 1, 3835, 3840, 6, "Stopped out early", "Stop was too tight for the noise."],
    ["2026-10-06", "long", 3, 3802, 3831, 18, "Follow through trade", "Broke the prior high and held."],
    ["2026-10-07", "long", 1, 3828, 3819, 6, "Market sluggish", "No momentum, cut it."],
    ["2026-10-09", "short", 2, 3846, 3821, 12, "Plan followed", "Clean rejection at resistance."],
    ["2026-10-13", "long", 1, 3795, 3801, 6, "Scratch exit", "Flat before the inventory report."],
    ["2026-10-15", "long", 2, 3815, 3804, 12, "Chased entry", "Entered late after the move already started."],
    ["2026-10-20", "short", 1, 3830, 3849, 6, "Loss Managed", "Wrong side of the trend, took the loss."],
  ];
  return base.map(([date, side, lots, entry, exit, commission, tag, note], i) => ({
    id: "demo" + i, date, side, contract: "FCPO", lots, entry, exit, commission, tag, note,
  }));
}

render();
