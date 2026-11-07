/* Risk rules — the "Perlu Berjaga-jaga" panel.
 *
 * WHY THIS IS THE MOST VALUABLE PANEL IN A JOURNAL. Every trader's worst days share a shape: the
 * third and fourth trade after two losses. A journal that only totals P/L tells you about it a month
 * later; this tells you while you can still close the laptop.
 *
 * The rules are behavioural, not moral: they describe a state, and the trader decides. Nothing here
 * blocks a trade — the app is a mirror, not a locking mechanism.
 */

const RULES = {
  maxTradesPerDay: 3,        // beyond this, attention is usually gone rather than the market
  maxConsecutiveLosses: 2,   // the third trade after two losses is where accounts die
  dailyLossLimitR: 2,        // stop for the day at -2R
};

/**
 * @param rows computed trades (with `net`), oldest first
 * @param ruleSet overrides
 * @returns {{level: 'clear'|'caution'|'stop', messages: string[], stats: object}}
 */
function riskCheck(rows, ruleSet) {
  const r = { ...RULES, ...(ruleSet || {}) };
  const messages = [];

  const byDay = new Map();
  for (const t of rows) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  const days = [...byDay.keys()].sort();
  const lastDay = days[days.length - 1];
  const today = lastDay ? byDay.get(lastDay) : [];

  const dayNet = today.reduce((s, t) => s + t.net, 0);
  const dayLoss = Math.min(0, dayNet);

  // consecutive losses, counted from the most recent trade backwards
  let consecutiveLosses = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].net < 0) consecutiveLosses++;
    else break;
  }

  // R is the average loss on this account, measured from the days BEFORE the one being judged.
  //
  // Including today's losses in the baseline lets the day drag its own ruler: a single bad day both
  // deepens the loss and enlarges the average, so -2R quietly reads as -1.3R and the limit never
  // fires. The baseline has to be what your risk looked like when you started the session.
  // Falls back to all losses when there is no earlier history.
  const priorLosses = rows.filter((t) => t.net < 0 && t.date < lastDay);
  const basis = priorLosses.length ? priorLosses : rows.filter((t) => t.net < 0);
  const avgLoss = basis.length ? Math.abs(basis.reduce((s, t) => s + t.net, 0) / basis.length) : 0;
  const dayR = avgLoss > 0 ? dayNet / avgLoss : 0;

  if (today.length >= r.maxTradesPerDay) {
    messages.push(`${today.length} trades on ${lastDay}. Past three, it is usually attention rather than the market.`);
  }
  if (consecutiveLosses >= r.maxConsecutiveLosses) {
    messages.push(`${consecutiveLosses} losses in a row. The next trade is the one to skip.`);
  }
  if (avgLoss > 0 && dayR <= -r.dailyLossLimitR) {
    messages.push(`Down ${Math.abs(dayR).toFixed(1)}R on ${lastDay} — past the ${r.dailyLossLimitR}R daily limit.`);
  }

  let level = "clear";
  if (messages.length) level = "caution";
  if (consecutiveLosses >= r.maxConsecutiveLosses + 1 || (avgLoss > 0 && dayR <= -r.dailyLossLimitR * 1.5)) {
    level = "stop";
  }

  return {
    level,
    messages,
    stats: {
      day: lastDay || null,
      tradesToday: today.length,
      dayNet,
      dayR,
      consecutiveLosses,
      avgLoss,
      ...r,
    },
  };
}

if (typeof module !== "undefined") module.exports = { riskCheck, RULES };
