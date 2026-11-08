/* A month calendar of daily net P/L.
 *
 * WHY A CALENDAR AND NOT ANOTHER CHART
 *   The growth curve answers "am I up overall". It cannot answer "which days do I lose on", which is
 *   the question that changes behaviour: Monday? the day after a big win? the third loss in a row?
 *   A month grid makes the pattern visible without asking you to read a line.
 *
 * FIVE COLUMNS, NOT SEVEN
 *   FCPO trades Monday to Friday. Weekend columns would be permanently empty and would halve the
 *   width of every number, so the grid is Mon–Fri only.
 *
 * NO COLOUR WITHOUT A NUMBER
 *   A day with no trades is left blank rather than shaded as zero. "No data" and "broke even" are
 *   different facts and a heatmap that paints them the same is lying.
 */

let calendarMonth = null; // {y, m} — m is 0-based

function calendarAnchor() {
  if (calendarMonth) return calendarMonth;
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() };
}

function shiftCalendar(delta) {
  const a = calendarAnchor();
  const d = new Date(a.y, a.m + delta, 1);
  calendarMonth = { y: d.getFullYear(), m: d.getMonth() };
  renderCalendar();
}

function dailyNet(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const day = String(r.date || "").slice(0, 10);
    if (!day) return;
    map.set(day, (map.get(day) || 0) + r.net);
  });
  return map;
}

function renderCalendar() {
  const host = document.getElementById("calendar");
  const label = document.getElementById("calendar-label");
  if (!host) return;

  const { y, m } = calendarAnchor();
  const monthName = new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  if (label) label.textContent = monthName;

  const nets = dailyNet(liveTrades().map(computeTrade));
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // Monday-first index of the 1st (JS: Sunday = 0)
  const firstWeekday = (first.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const head = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    .map((d) => `<div class="cal-head">${d}</div>`)
    .join("");

  let body = "";
  let week = "";
  let col = 0;

  const pushDay = (day) => {
    if (day === null) return "<div class=\"cal-cell empty\"></div>";
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = (new Date(y, m, day).getDay() + 6) % 7;
    const has = nets.has(iso);
    const value = has ? nets.get(iso) : 0;
    const cls = !has ? "cal-cell" : value > 0 ? "cal-cell good" : value < 0 ? "cal-cell bad" : "cal-cell flat";
    const text = !has ? "" : `<span class="cal-amt">${value > 0 ? "+" : ""}${Math.round(value).toLocaleString()}</span>`;
    // Weekend days are rendered but never show a number: FCPO does not trade then.
    return `<div class="${cls}${weekday > 4 ? " weekend" : ""}" title="${iso}"><span class="cal-d">${day}</span>${text}</div>`;
  };

  cells.forEach((day, i) => {
    week += pushDay(day);
    col += 1;
    if (col === 5) {
      body += `<div class="cal-week">${week}</div>`;
      week = "";
      col = 0;
    }
  });
  if (week) body += `<div class="cal-week">${week}</div>`;

  host.innerHTML = `<div class="cal-heads">${head}</div>${body}`;

  const monthTotal = Array.from(nets.entries())
    .filter(([k]) => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`))
    .reduce((s, [, v]) => s + v, 0);
  const note = document.getElementById("calendar-note");
  if (note) {
    note.textContent = nets.size
      ? `${monthName}: ${rm(monthTotal)} across ${Array.from(nets.keys()).filter((k) => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).length} trading days`
      : `${monthName}: no trades`;
  }
}
