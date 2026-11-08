/* Tests for setups.js — the parts that decide whether a plan was any good.
 * Pure functions, no DOM, so these run in node directly. */
const assert = require("assert");
const S = require(__dirname + "/setups.js");

let pass = 0;
const fails = [];
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fails.push(`${name}\n     ${e.message.split("\n")[0]}`);
  }
}

/* ---------- R:R ---------- */

t("long: 10 risk / 30 reward is 3R", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 130 });
  assert.strictEqual(S.rr(s, s.tp1), 3);
});

t("short: 10 risk / 20 reward is 2R", () => {
  const s = S.newSetup({ direction: "short", entry: 100, stop: 110, tp1: 80 });
  assert.strictEqual(S.rr(s, s.tp1), 2);
});

t("no stop means no R at all, not infinity", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 100, tp1: 120 });
  assert.strictEqual(S.rr(s, s.tp1), null);
});

/* ---------- outcome ---------- */

t("long closed at target 2 scores 2R", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, tp2: 130 });
  s.outcome = 130;
  assert.strictEqual(S.outcomeR(s), 3); // (130-100)/10
  assert.strictEqual(S.reachedTp(s), 2);
});

t("short stopped out scores -1R", () => {
  const s = S.newSetup({ direction: "short", entry: 100, stop: 110, tp1: 80 });
  s.outcome = 110;
  assert.strictEqual(S.outcomeR(s), -1);
  assert.strictEqual(S.reachedTp(s), 0);
});

t("a scratch scores 0R, not a win", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120 });
  s.outcome = 100;
  assert.strictEqual(S.outcomeR(s), 0);
});

t("no outcome yet returns null, so averages skip it", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120 });
  assert.strictEqual(S.outcomeR(s), null);
});

/* ---------- validation: the errors that make a result meaningless ---------- */

t("long with the stop above entry is refused", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 110, tp1: 120 });
  assert.ok(S.validateSetup(s).some((p) => p.includes("wrong side")));
});

t("short with the target above entry is refused", () => {
  const s = S.newSetup({ direction: "short", entry: 100, stop: 110, tp1: 105 });
  assert.ok(S.validateSetup(s).some((p) => p.includes("wrong side")));
});

t("targets in the wrong order are refused", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, tp2: 115 });
  assert.ok(S.validateSetup(s).some((p) => p.includes("tp2") || p.includes("take profit 2")));
});

t("a correct long passes", () => {
  const s = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 110, tp2: 120, tp3: 130 });
  assert.deepStrictEqual(S.validateSetup(s), []);
});

/* ---------- stats ---------- */

t("trigger rate counts plans that were taken, including closed ones", () => {
  const list = [
    S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "planned" }),
    S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "triggered" }),
    S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed" }),
    S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "planned" }),
  ];
  list[2].outcome = 120;
  const st = S.setupStats(list);
  assert.strictEqual(st.planned, 4);
  assert.strictEqual(st.triggered, 2);
  assert.strictEqual(st.triggerRate, 0.5);
});

t("avg R ignores open setups and archived plans", () => {
  const a = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed" });
  a.outcome = 120;                       // +2R
  const b = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed" });
  b.outcome = 90;                        // -1R
  const c = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "planned" });
  const arch = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed", archived: true });
  arch.outcome = 60;                     // would be -4R if it counted

  const st = S.setupStats([a, b, c, arch]);
  assert.strictEqual(st.closed, 2);
  assert.strictEqual(st.avgR, 0.5);      // (2 + -1) / 2
  assert.strictEqual(st.planned, 3);     // archived excluded
});

t("stop-out rate counts results at or beyond -1R", () => {
  const a = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed" });
  a.outcome = 85;                        // -1.5R
  const b = S.newSetup({ direction: "long", entry: 100, stop: 90, tp1: 120, status: "closed" });
  b.outcome = 115;                       // +1.5R
  const st = S.setupStats([a, b]);
  assert.strictEqual(st.stopOutRate, 0.5);
});

t("empty list does not divide by zero", () => {
  const st = S.setupStats([]);
  assert.strictEqual(st.triggerRate, 0);
  assert.strictEqual(st.avgR, 0);
  assert.strictEqual(st.planned, 0);
});

/* ---------- report ---------- */

console.log(`  ${pass} passed, ${fails.length} failed`);
fails.forEach((f) => console.log(`  FAIL  ${f}`));
process.exit(fails.length ? 1 : 0);
