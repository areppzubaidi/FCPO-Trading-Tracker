/* Rate-card tests. Every expected number below is hand-computed in the comment beside it, so a
 * failure means either the code or the arithmetic is wrong — never "the test agreed with itself". */

const fs = require("fs");
const vm = require("vm");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + "/fees.js", "utf8"), ctx);

// `const` and `let` in a vm script do not become properties of the context object, so the exports
// have to be read back with an expression rather than off `ctx` directly.
const api = vm.runInContext(
  "({ FEE_PROFILES, computeFees, tieredBrokerage, feesForSide })",
  ctx,
);

let pass = 0;
let fail = 0;
const failures = [];

function eq(label, actual, expected, tol = 0.005) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${label}: got ${actual}, expected ${expected}`);
  }
}

/* ── FCPO futures ─────────────────────────────────────────────────────────────────────────────
 * 2 lots, 4000 -> 4005, RM25/point: gross = 2 * 5 * 25 = 250
 * brokerage 10/lot/side x 2 lots x 2 sides = 40
 * clearing  0.50/lot/side x 2 x 2        = 2.00
 * exchange  0.25/lot/side x 2 x 2        = 1.00
 * sst       8% of brokerage              = 3.20
 * total                                  = 46.20   net = 203.80
 */
const f = api.computeFees("fcpo", { lots: 2, entry: 4000, exit: 4005 });
eq("fcpo brokerage", f.brokerage, 40);
eq("fcpo clearing", f.clearing, 2);
eq("fcpo exchange", f.exchange, 1);
eq("fcpo stamp (none on futures)", f.stamp, 0);
eq("fcpo sst", f.sst, 3.2);
eq("fcpo total", f.total, 46.2);
eq("fcpo breakdown is readable", f.breakdown.includes("brokerage"), 1);

/* ── Bursa equities, round trip ───────────────────────────────────────────────────────────────
 * buy  1000 @ 10.00 = 10,000 : brokerage 0.15% = 15.00 · clearing 0.03% = 3.00 · stamp 10 x RM1 = 10
 * sell 1000 @ 10.50 = 10,500 : brokerage 0.15% = 15.75 · clearing 0.03% = 3.15 · stamp 11 x RM1 = 11
 * totals: brokerage 30.75 · clearing 6.15 · stamp 21.00 · sst 8% of 30.75 = 2.46 · total 60.36
 */
const e = api.computeFees("bursa", { lots: 1000, entry: 10, exit: 10.5 });
eq("bursa brokerage", e.brokerage, 30.75);
eq("bursa clearing", e.clearing, 6.15);
eq("bursa stamp", e.stamp, 21);
eq("bursa sst", e.sst, 2.46);
eq("bursa total", e.total, 60.36);

/* ── the guards that stop a rate card from being wrong in the expensive direction ───────────── */
eq("minimum brokerage applies", api.feesForSide(api.FEE_PROFILES.bursa, 1000, 1000).brokerage, 8);
eq("clearing is capped", api.feesForSide(api.FEE_PROFILES.bursa, 5000000, 5000000).clearing, 1000);
eq("stamp duty is capped", api.feesForSide(api.FEE_PROFILES.bursa, 2000000, 2000000).stamp, 1000);

/* progressive bands on RM600,000: 100k @0.15% = 150 · 400k @0.10% = 400 · 100k @0.08% = 80 → 630 */
eq("tiered brokerage across all three bands", api.tieredBrokerage(600000, api.FEE_PROFILES.bursa.brokerageTiers), 630);

/* ── a manual model must refuse to invent a number ──────────────────────────────────────────── */
eq("manual profile computes nothing", api.computeFees("manual", { lots: 1, entry: 1, exit: 2 }), null);
eq("a trade without lots computes nothing", api.computeFees("fcpo", { lots: 0, entry: 4000, exit: 4005 }), null);
eq("a trade without prices computes nothing", api.computeFees("fcpo", { lots: 2, entry: 0, exit: 4005 }), null);

console.log(`\nfees: ${pass} passed, ${fail} failed`);
if (fail) {
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
