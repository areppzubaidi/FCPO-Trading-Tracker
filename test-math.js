/* Harness: run app.js in node with a minimal DOM stub, then check the money math against values
 * computed by hand. The point is that "it renders" is not "it computes correctly". */
const fs = require("fs");
const vm = require("vm");

const el = () => ({
  innerHTML: "", textContent: "", value: "", dataset: {},
  addEventListener: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  reset: () => {}, click: () => {}, closest: () => null, querySelectorAll: () => [],
});
global.document = {
  getElementById: el, querySelectorAll: () => [], querySelector: el,
  createElement: () => ({ click: () => {}, set href(v) {}, set download(v) {} }),
  addEventListener: () => {},
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => false;
global.URL = { createObjectURL: () => "blob:", revokeObjectURL: () => {} };
global.Blob = class {};

// app.js now calls parseStatement/riskCheck at render time, so those modules have to exist in the
// same context first. Function declarations in a classic script land on the global object, which is
// exactly how the browser loads these three files.
vm.runInThisContext(fs.readFileSync("/app/statement.js", "utf8"));
vm.runInThisContext(fs.readFileSync("/app/risk.js", "utf8"));

let src = fs.readFileSync("/app/app.js", "utf8");
src += "\nglobalThis.__t = { computeTrade, metrics, demo };";
vm.runInThisContext(src);

const { computeTrade, metrics, demo } = globalThis.__t;
const m = metrics(demo());

const close = (a, b, tol) => Math.abs(a - b) <= (tol || 0.005);
const checks = [
  ["trade 1 net (long 2 lots, +12 pts, RM12 comm, 8% SST)", computeTrade({ side: "long", lots: 2, entry: 3810, exit: 3822, commission: 12 }).net, 587.04],
  ["trade 2 net (short 1 lot, moved against by 5)", computeTrade({ side: "short", lots: 1, entry: 3835, exit: 3840, commission: 6 }).net, -131.48],
  // short that moved 25 points in your favour, 2 lots: 25 * 2 * RM25 = 1250 gross, less
  // RM12 commission and RM0.96 SST. The sign is the point of this check.
  ["short direction sign", computeTrade({ side: "short", lots: 2, entry: 3846, exit: 3821, commission: 12 }).net, 1237.04],
  ["SST is 8% of commission, not of P/L", computeTrade({ side: "long", lots: 1, entry: 3800, exit: 3810, commission: 100 }).sst, 8],
  ["total net", m.net, 2715.76],
  ["win rate", m.winRate, 50],
  ["gross wins", m.grossWin, 4123.16],
  ["gross losses", m.grossLoss, 1407.4],
  ["profit factor", m.profitFactor, 2.9302, 0.01],
  ["avg win", m.avgWin, 1030.79, 0.01],
  ["avg loss", m.avgLoss, 351.85, 0.01],
  ["max win streak", m.maxWin, 2],
  ["max loss streak", m.maxLoss, 2],
  ["max drawdown", m.maxDD, 1044.44, 0.01],
  ["closed trades", m.closed, 8],
  ["curve length", m.curve.length, 8],
  ["final curve value == net", m.curve[m.curve.length - 1].value, 2715.76],
];

let pass = 0, fail = 0;
for (const [label, got, want, tol] of checks) {
  const ok = close(got, want, tol);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        got ${got}  want ${want}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
console.log("by side:", JSON.stringify(m.bySide));
console.log("by month:", JSON.stringify(m.byMonth));
process.exit(fail ? 1 : 0);
