/* Tests for statement parsing and the risk rules.
 * These run against the real modules with node — no browser, no stubs, because both are pure. */
const assert = require("assert");
const { parseStatement, parseDate, parseNumber, parseSide, dropDuplicates } = require("./statement.js");
const { riskCheck } = require("./risk.js");

let pass = 0, fail = 0;
function t(label, fn) {
  try { fn(); pass++; console.log("PASS  " + label); }
  catch (e) { fail++; console.log("FAIL  " + label + "\n        " + e.message); }
}

/* ---------- dates ---------- */
t("DD/MM/YYYY is day-first", () => assert.strictEqual(parseDate("02/10/2026"), "2026-10-02"));
t("an impossible month flips to month-first rather than guessing", () =>
  assert.strictEqual(parseDate("10/25/2026"), "2026-10-25"));
t("ISO passes through", () => assert.strictEqual(parseDate("2026-10-02"), "2026-10-02"));
t("06-Oct-26 expands the year", () => assert.strictEqual(parseDate("06-Oct-26"), "2026-10-06"));
t("06 October 2026 with spaces", () => assert.strictEqual(parseDate("6 October 2026"), "2026-10-06"));
t("nonsense is null, not today", () => assert.strictEqual(parseDate("total"), null));

/* ---------- numbers ---------- */
t("thousands separator", () => assert.strictEqual(parseNumber("3,810.50"), 3810.5));
t("RM prefix stripped", () => assert.strictEqual(parseNumber("RM 1,234.00"), 1234));
t("blank is null", () => assert.strictEqual(parseNumber(""), null));
t("text is null, not NaN", () => assert.strictEqual(parseNumber("abc"), null));
t("zero is zero, not null", () => assert.strictEqual(parseNumber("0"), 0));

/* ---------- sides ---------- */
t("Buy -> long", () => assert.strictEqual(parseSide("Buy"), "long"));
t("SELL -> short", () => assert.strictEqual(parseSide("SELL"), "short"));
t("long/short words", () => {
  assert.strictEqual(parseSide("long"), "long");
  assert.strictEqual(parseSide("Short"), "short");
});
t("unknown side is null", () => assert.strictEqual(parseSide("transfer"), null));

/* ---------- whole statements ---------- */
t("tab-delimited, no header", () => {
  const r = parseStatement("02/10/2026\tBuy\t2\t3810\t3822\t12.00\n03/10/2026\tSell\t1\t3835\t3840\t6.00");
  assert.strictEqual(r.trades.length, 2);
  assert.strictEqual(r.trades[0].side, "long");
  assert.strictEqual(r.trades[1].side, "short");
  assert.strictEqual(r.trades[0].commission, 12);
  assert.strictEqual(r.skipped.length, 0);
});

t("comma-delimited with a header row", () => {
  const r = parseStatement(
    "Date,Side,Lots,Entry,Exit,Commission\n06-Oct-26,Buy,3,3802,3831,18"
  );
  assert.strictEqual(r.trades.length, 1);
  assert.strictEqual(r.trades[0].date, "2026-10-06");
  assert.strictEqual(r.trades[0].lots, 3);
});

t("header columns matched by name, in any order", () => {
  const r = parseStatement(
    "Entry,Exit,Lots,Side,Date\n3795,3801,1,Buy,09/10/2026"
  );
  assert.strictEqual(r.trades.length, 1, "one trade");
  assert.strictEqual(r.trades[0].entry, 3795);
  assert.strictEqual(r.trades[0].exit, 3801);
});

t("unreadable rows are reported, not dropped silently", () => {
  const r = parseStatement("02/10/2026\tBuy\t2\t3810\t3822\t12\nTOTAL\t\t\t\t\t144\n");
  assert.strictEqual(r.trades.length, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.ok(/date/i.test(r.skipped[0].reason), "reason names the problem: " + r.skipped[0].reason);
});

t("a row with no side is skipped with a clear reason", () => {
  const r = parseStatement("02/10/2026\ttransfer\t2\t3810\t3822\t0");
  assert.strictEqual(r.trades.length, 0);
  assert.ok(/buy\/sell|side/i.test(r.skipped[0].reason));
});

t("empty input is empty, not a crash", () => {
  const r = parseStatement("");
  assert.deepStrictEqual(r.trades, []);
});

/* ---------- duplicates ---------- */
t("the same fill twice is caught", () => {
  const existing = [{ date: "2026-10-02", side: "long", lots: 2, entry: 3810, exit: 3822 }];
  const incoming = [
    { date: "2026-10-02", side: "long", lots: 2, entry: 3810, exit: 3822 },
    { date: "2026-10-03", side: "short", lots: 1, entry: 3835, exit: 3840 },
  ];
  const { fresh, dupes } = dropDuplicates(incoming, existing);
  assert.strictEqual(dupes.length, 1);
  assert.strictEqual(fresh.length, 1);
});

/* ---------- risk rules ---------- */
const mk = (date, net) => ({ date, net });

t("a clean day raises nothing", () => {
  const r = riskCheck([mk("2026-10-01", 500), mk("2026-10-02", -200)]);
  assert.strictEqual(r.level, "clear");
  assert.strictEqual(r.messages.length, 0);
});

t("three trades in a day is a caution", () => {
  const r = riskCheck([mk("2026-10-02", 100), mk("2026-10-02", 100), mk("2026-10-02", -50)]);
  assert.strictEqual(r.level, "caution");
  assert.ok(r.messages.some((m) => /3 trades/.test(m)), JSON.stringify(r.messages));
});

t("two losses in a row warns about the next one", () => {
  const r = riskCheck([mk("2026-10-01", 400), mk("2026-10-02", -200), mk("2026-10-02", -300)]);
  assert.ok(r.messages.some((m) => /losses in a row/.test(m)), JSON.stringify(r.messages));
  assert.strictEqual(r.stats.consecutiveLosses, 2);
});

t("R is measured against the average loss, not an arbitrary number", () => {
  // baseline is the -250 loss on the PRIOR day, so a -500 day is exactly -2R.
  // (Measured against all losses including the day itself it would read -1.3R, and a -2R
  //  limit would never fire — which is why the code uses the prior-day baseline.)
  const r = riskCheck([mk("2026-10-01", -250), mk("2026-10-02", -500)]);
  assert.strictEqual(Math.round(r.stats.dayR * 10) / 10, -2);
});

t("three losses in a row escalates to stop", () => {
  const r = riskCheck([mk("2026-10-01", -100), mk("2026-10-01", -100), mk("2026-10-01", -100)]);
  assert.strictEqual(r.level, "stop");
});

t("no trades means no risk state, not a divide-by-zero", () => {
  const r = riskCheck([]);
  assert.strictEqual(r.level, "clear");
  assert.strictEqual(r.stats.day, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
