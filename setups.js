/* Setups — the planned trade, before it becomes a trade.
 *
 * WHAT THIS IS BORROWED FROM. A signals app I looked at (traxatradingapp.com) publishes each setup as
 * a card: entry zone, stop loss, three take-profit levels, a risk grade, and a status that moves as
 * price does. Its best idea is not the signals — it is that every setup is tracked from the moment it
 * is published, and nothing is deleted afterwards.
 *
 * WHAT IS DELIBERATELY NOT BORROWED: their signal data, their performance figures, and their referral
 * structure. Data belongs to them; numbers you cannot verify are not evidence.
 *
 * WHY THIS BELONGS IN A JOURNAL. A blotter records what you DID. A setup record captures what you
 * PLANNED — including the ones you never took. Without it you cannot answer the only question that
 * matters after a losing month: "were my ideas bad, or was my execution bad?"
 */

const SETUP_STATUSES = ["planned", "triggered", "closed"];
const RISK_GRADES = ["low", "medium", "high"];

let setupSeq = 1;

function newSetup(fields) {
  const dir = fields.direction === "short" ? -1 : 1;
  return {
    id: fields.id || `s${Date.now()}${setupSeq++}`,
    created: fields.created || new Date().toISOString().slice(0, 10),
    instrument: fields.instrument || "FCPO",
    direction: dir === 1 ? "long" : "short",
    entry: Number(fields.entry),
    stop: Number(fields.stop),
    tp1: Number(fields.tp1),
    tp2: fields.tp2 === undefined || fields.tp2 === "" ? null : Number(fields.tp2),
    tp3: fields.tp3 === undefined || fields.tp3 === "" ? null : Number(fields.tp3),
    risk: RISK_GRADES.includes(fields.risk) ? fields.risk : "medium",
    note: fields.note || "",
    status: SETUP_STATUSES.includes(fields.status) ? fields.status : "planned",
    outcome: fields.outcome ? Number(fields.outcome) : null,
    archived: Boolean(fields.archived),
  };
}

/** Risk per unit, in price terms. A setup with no stop has no risk, and therefore no R. */
function riskDistance(s) {
  return Math.abs(s.entry - s.stop);
}

/** Reward:risk for one target. Returns null when there is no stop to measure against. */
function rr(s, target) {
  const risk = riskDistance(s);
  if (!risk || target === null || target === undefined) return null;
  const dir = s.direction === "short" ? -1 : 1;
  return ((target - s.entry) * dir) / risk;
}

/**
 * R multiple of the outcome.
 *
 * Positive when the exit is on the profitable side of entry, negative when it is not, and measured in
 * units of the risk the setup declared — which is why a setup taken with a wide stop scores less than
 * the same result with a tight one.
 */
function outcomeR(s) {
  if (s.outcome === null || s.outcome === undefined) return null;
  const risk = riskDistance(s);
  if (!risk) return null;
  const dir = s.direction === "short" ? -1 : 1;
  return ((s.outcome - s.entry) * dir) / risk;
}

/** Which take-profit level the outcome reached (0 = none), useful for "did the idea work". */
function reachedTp(s) {
  if (s.outcome === null || s.outcome === undefined) return 0;
  const dir = s.direction === "short" ? -1 : 1;
  let hit = 0;
  [s.tp1, s.tp2, s.tp3].forEach((tp, i) => {
    if (tp === null || tp === undefined) return;
    if ((s.outcome - tp) * dir >= 0) hit = i + 1;
  });
  return hit;
}

/**
 * A setup whose stop is on the wrong side of entry scores negative R whichever way price goes.
 * Catching it at entry time is cheaper than discovering it in a blotter review.
 */
function validateSetup(s) {
  const problems = [];
  const dir = s.direction === "short" ? -1 : 1;
  if (!Number.isFinite(s.entry)) problems.push("entry must be a number");
  if (!Number.isFinite(s.stop)) problems.push("stop must be a number");
  if (!Number.isFinite(s.tp1)) problems.push("take profit 1 must be a number");
  if (problems.length) return problems;

  if ((s.stop - s.entry) * dir >= 0) problems.push("stop is on the wrong side of entry");
  if ((s.tp1 - s.entry) * dir <= 0) problems.push("take profit 1 is on the wrong side of entry");
  [["tp2", s.tp2], ["tp3", s.tp3]].forEach(([name, tp]) => {
    if (tp === null || tp === undefined) return;
    if ((tp - s.entry) * dir <= 0) problems.push(`${name} is on the wrong side of entry`);
  });
  if (s.tp2 !== null && s.tp2 !== undefined) {
    if ((s.tp2 - s.tp1) * dir <= 0) problems.push("take profit 2 is not beyond take profit 1");
  }
  if (s.tp3 !== null && s.tp3 !== undefined) {
    const ref = s.tp2 !== null && s.tp2 !== undefined ? s.tp2 : s.tp1;
    if ((s.tp3 - ref) * dir <= 0) problems.push("take profit 3 is not beyond the previous target");
  }
  return problems;
}

/**
 * Stats over setups.
 *
 * The number that matters is `triggerRate`: how many of your plans the market actually came to you
 * for. A trader who plans ten and takes two has a different problem from one who takes nine, and no
 * blotter can tell them apart.
 */
function setupStats(list) {
  const live = list.filter((s) => !s.archived);
  const closed = live.filter((s) => s.status === "closed" && s.outcome !== null);
  const rs = closed.map(outcomeR).filter((r) => r !== null);

  const planned = live.length;
  const triggered = live.filter((s) => s.status === "triggered" || s.status === "closed").length;

  const tp1Hits = closed.filter((s) => reachedTp(s) >= 1).length;
  const stopOuts = rs.filter((r) => r <= -1).length;

  return {
    planned,
    triggered,
    closed: closed.length,
    triggerRate: planned ? triggered / planned : 0,
    tp1HitRate: closed.length ? tp1Hits / closed.length : 0,
    stopOutRate: closed.length ? stopOuts / closed.length : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    bestR: rs.length ? Math.max(...rs) : 0,
    worstR: rs.length ? Math.min(...rs) : 0,
    totalR: rs.reduce((a, b) => a + b, 0),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { newSetup, rr, riskDistance, outcomeR, reachedTp, validateSetup, setupStats, SETUP_STATUSES, RISK_GRADES };
}
