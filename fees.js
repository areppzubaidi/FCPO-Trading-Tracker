/* Brokerage models — compute the cost of a round trip instead of trusting memory.
 *
 * WHY THIS EXISTS
 *   The journal used to ask you to type the commission. That is the number you are least likely to
 *   remember a week later, and it is the number that decides whether a 3-point scalp made money.
 *   A model derives it from the trade: lots, prices, and the rate card you actually pay.
 *
 * RATES ARE PRESETS, NOT TRUTH
 *   Malaysian brokerage is negotiated per account and moves when regulation does — clearing fee caps,
 *   stamp duty, the 8% service tax on brokerage. Every number below is an input you can change in
 *   the panel; the presets exist so you are not staring at a blank field and guessing.
 *
 * ROUND TRIP
 *   A journal row is a completed trade: in and out. Futures charge per lot per side; equities charge
 *   a percentage of each contract's value. Both sides are costed separately, because a tiered
 *   brokerage rate is not symmetric when the two sides differ in value.
 */

const FEE_STORE_KEY = "fcpo.feeProfile";

const FEE_PROFILES = {
  fcpo: {
    name: "FCPO futures — typical retail",
    kind: "futures",
    // Per lot, per side. A typical retail futures rate card is a flat brokerage plus small clearing
    // and exchange components; edit these to match your contract note.
    perLot: { brokerage: 10, clearing: 0.5, exchange: 0.25 },
    sstRate: 0.08,
    sstOn: "brokerage",
    note: "Flat per lot per side. SST applies to brokerage only.",
  },
  bursa: {
    name: "Bursa equities — typical retail",
    kind: "equities",
    // Progressive bands on each contract's value: first RM100k, next RM400k, beyond RM500k.
    brokerageTiers: [
      [100000, 0.0015],
      [500000, 0.001],
      [Infinity, 0.0008],
    ],
    minBrokeragePerSide: 8,
    clearingRate: 0.0003,
    clearingCap: 1000,
    stampPer1000: 1,
    stampCap: 1000,
    sstRate: 0.08,
    sstOn: "brokerage",
    note: "Tiered brokerage, 0.03% clearing (capped), stamp duty RM1 per RM1,000.",
  },
  manual: {
    name: "Manual — I type the commission",
    kind: "manual",
    note: "No calculation. Whatever you enter is what gets used.",
  },
};

function feeProfileKey() {
  try {
    const k = localStorage.getItem(FEE_STORE_KEY);
    return FEE_PROFILES[k] ? k : "fcpo";
  } catch (e) {
    return "fcpo";
  }
}

function setFeeProfile(key) {
  if (!FEE_PROFILES[key]) return;
  try {
    localStorage.setItem(FEE_STORE_KEY, key);
  } catch (e) {
    /* storage blocked: the profile applies to this page load only */
  }
}

function feeProfile() {
  return FEE_PROFILES[feeProfileKey()];
}

/* Progressive banding: each slice of the contract value is charged at its own rate. */
function tieredBrokerage(value, tiers) {
  let remaining = Number(value) || 0;
  let lower = 0;
  let fee = 0;
  for (let i = 0; i < tiers.length && remaining > 0; i += 1) {
    const cap = tiers[i][0];
    const rate = tiers[i][1];
    const band = Math.min(remaining, cap - lower);
    if (band <= 0) break;
    fee += band * rate;
    remaining -= band;
    lower = cap;
  }
  return fee;
}

/* Cost one side of a contract. */
function feesForSide(profile, value, lots) {
  if (profile.kind === "futures") {
    const n = Number(lots) || 0;
    return {
      brokerage: profile.perLot.brokerage * n,
      clearing: profile.perLot.clearing * n,
      exchange: profile.perLot.exchange * n,
      stamp: 0,
    };
  }
  if (profile.kind === "equities") {
    const brokerage = Math.max(
      profile.minBrokeragePerSide,
      tieredBrokerage(value, profile.brokerageTiers),
    );
    const clearing = Math.min(value * profile.clearingRate, profile.clearingCap);
    // Stamp duty is charged per RM1,000 or part thereof, on each contract.
    const stamp = Math.min(Math.ceil(value / 1000) * profile.stampPer1000, profile.stampCap);
    return { brokerage, clearing, exchange: 0, stamp };
  }
  return { brokerage: 0, clearing: 0, exchange: 0, stamp: 0 };
}

/* Total round-trip cost, with the parts kept separate so the panel can explain itself. */
function computeFees(key, trade) {
  const profile = FEE_PROFILES[key] || FEE_PROFILES.manual;
  if (profile.kind === "manual") return null;

  const lots = Number(trade.lots) || 0;
  const entry = Number(trade.entry) || 0;
  const exit = Number(trade.exit) || 0;
  if (!lots || !entry || !exit) return null;

  const inSide = feesForSide(profile, lots * entry, lots);
  const outSide = feesForSide(profile, lots * exit, lots);

  const brokerage = inSide.brokerage + outSide.brokerage;
  const clearing = inSide.clearing + outSide.clearing;
  const exchange = inSide.exchange + outSide.exchange;
  const stamp = inSide.stamp + outSide.stamp;
  const sst = brokerage * profile.sstRate;
  const total = brokerage + clearing + exchange + stamp + sst;

  const parts = [];
  parts.push(`brokerage ${brokerage.toFixed(2)}`);
  if (clearing) parts.push(`clearing ${clearing.toFixed(2)}`);
  if (exchange) parts.push(`exchange ${exchange.toFixed(2)}`);
  if (stamp) parts.push(`stamp ${stamp.toFixed(2)}`);
  parts.push(`sst ${sst.toFixed(2)}`);

  return { brokerage, clearing, exchange, stamp, sst, total, breakdown: parts.join(" · ") };
}

/* The dashboard panel: which rate card is in force, and what it would charge for a typical trade. */
function renderFeePanel() {
  const host = document.getElementById("fee-profile");
  if (!host) return;
  const key = feeProfileKey();
  const profile = FEE_PROFILES[key];

  const options = Object.keys(FEE_PROFILES)
    .map((k) => `<option value="${k}"${k === key ? " selected" : ""}>${escapeHtml(FEE_PROFILES[k].name)}</option>`)
    .join("");

  // Worked example: sized from the last real trade, so the numbers are yours and not invented.
  const sample = liveTrades()
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  let example = "";
  if (sample && profile.kind !== "manual") {
    const f = computeFees(key, sample);
    if (f) {
      example =
        `<p class="muted">Last trade (${sample.date}, ${sample.lots} lots ${sample.entry}→${sample.exit}): ` +
        `${escapeHtml(f.breakdown)} = <strong>${rm(f.total)}</strong></p>`;
    }
  }

  host.innerHTML =
    `<div class="row"><label for="fee-select" class="muted">Rate card</label>` +
    `<select id="fee-select">${options}</select></div>` +
    `<p class="muted">${escapeHtml(profile.note)}</p>` +
    example +
    `<p class="muted">Leave the commission field blank on a new trade to use this model; type a number to override it for that trade.</p>`;

  const sel = document.getElementById("fee-select");
  if (sel && !sel.dataset.bound) {
    sel.addEventListener("change", (e) => {
      setFeeProfile(e.target.value);
      render();
    });
    sel.dataset.bound = "1";
  }
}
