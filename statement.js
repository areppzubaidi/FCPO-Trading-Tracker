/* Statement parsing.
 *
 * WHY NOT A PDF PARSER. The reference app parses broker PDFs (Phillip Capital, Webull, CGS) with a
 * different regex set per broker. That is per-broker guesswork until you have the actual statement in
 * front of you, and a parser that silently mis-reads a commission column is worse than no import.
 *
 * So this takes the text you can already get out of any statement — select the rows in the PDF, or
 * export CSV from the broker portal, and paste. It handles the messy parts that make that painful:
 * header detection, DD/MM/YYYY vs YYYY-MM-DD vs 06-Oct-26, thousands separators, "RM" prefixes,
 * buy/sell vs long/short, and rows that cannot be parsed (which are reported, never dropped silently).
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseDate(raw) {
  const s = String(raw || "").trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    // Malaysian statements are day-first. A "month" above 12 is the only way to be sure,
    // and guessing wrong silently reverses the date, so it is worth being explicit here.
    const d = Number(m[1]), mo = Number(m[2]), y = m[3];
    if (mo > 12 && d <= 12) return `${y}-${String(d).padStart(2, "0")}-${String(mo).padStart(2, "0")}`;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{2,4})$/))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)) + 1;
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    if (mo) return `${y}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return null;
}

function parseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/rm/gi, "").replace(/[,\s]/g, "").trim();
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

function parseSide(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (/^(b|buy|long|l)$/.test(s)) return "long";
  if (/^(s|sell|short)$/.test(s)) return "short";
  return null;
}

function detectDelimiter(line) {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (tabs >= 1 && tabs >= commas) return "\t";
  if (commas >= 1) return ",";
  return /\s{2,}/;
}

const HEADER_HINTS = /(date|tarikh|side|type|buy|sell|qty|lots?|quantity|entry|exit|price|commission|fee|brokerage)/i;

/**
 * @returns {{trades: Array, skipped: Array<{line: number, text: string, reason: string}>, delimiter: string}}
 */
function parseStatement(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const skipped = [];
  const trades = [];
  if (!lines.length) return { trades, skipped, delimiter: "," };

  const delimiter = detectDelimiter(lines[0]);
  const split = (line) => (delimiter instanceof RegExp ? line.split(delimiter) : line.split(delimiter)).map((c) => c.trim());

  // header mapping, if the first row looks like headings rather than data
  let map = null;
  let start = 0;
  if (HEADER_HINTS.test(lines[0]) && !parseDate(split(lines[0])[0])) {
    const cols = split(lines[0]).map((c) => c.toLowerCase());
    const find = (names) => cols.findIndex((c) => names.some((n) => c.includes(n)));
    map = {
      date: find(["date", "tarikh"]),
      side: find(["side", "type", "b/s", "buy"]),
      lots: find(["lot", "qty", "quantity", "contracts"]),
      entry: find(["entry", "open", "buy price"]),
      exit: find(["exit", "close", "sell price"]),
      commission: find(["commission", "fee", "brokerage"]),
    };
    start = 1;
  }

  lines.slice(start).forEach((line, i) => {
    const lineNo = i + start + 1;
    const cells = split(line);
    const pick = (idx, fallback) => (map && idx >= 0 ? cells[idx] : fallback < cells.length ? cells[fallback] : undefined);

    const date = parseDate(pick(map ? map.date : -1, 0));
    if (!date) { skipped.push({ line: lineNo, text: line, reason: "no recognisable date" }); return; }

    const side = parseSide(pick(map ? map.side : -1, 1));
    if (!side) { skipped.push({ line: lineNo, text: line, reason: "no buy/sell or long/short column" }); return; }

    const lots = parseNumber(pick(map ? map.lots : -1, 2));
    const entry = parseNumber(pick(map ? map.entry : -1, 3));
    const exit = parseNumber(pick(map ? map.exit : -1, 4));
    const commission = parseNumber(pick(map ? map.commission : -1, 5)) || 0;

    if (!lots || lots <= 0) { skipped.push({ line: lineNo, text: line, reason: "lots missing or not positive" }); return; }
    if (entry === null || exit === null) { skipped.push({ line: lineNo, text: line, reason: "entry/exit price not readable" }); return; }

    trades.push({
      id: "imp" + Date.now() + Math.random().toString(36).slice(2, 8),
      date, side, contract: "FCPO", lots, entry, exit, commission,
      tag: "", note: "imported from statement",
    });
  });

  return { trades, skipped, delimiter };
}

/* duplicate protection: same day, side, lots and prices is almost certainly the same fill */
function dropDuplicates(incoming, existing) {
  const key = (t) => `${t.date}|${t.side}|${Number(t.lots)}|${Number(t.entry)}|${Number(t.exit)}`;
  const seen = new Set(existing.map(key));
  const fresh = [];
  const dupes = [];
  for (const t of incoming) {
    if (seen.has(key(t))) { dupes.push(t); continue; }
    seen.add(key(t));
    fresh.push(t);
  }
  return { fresh, dupes };
}

if (typeof module !== "undefined") module.exports = { parseStatement, parseDate, parseNumber, parseSide, dropDuplicates };
