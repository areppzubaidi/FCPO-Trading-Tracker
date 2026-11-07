# FCPO Journal

A trade journal for FCPO (Bursa Malaysia crude palm oil futures). Single user, local-first, no
backend to operate. Built after studying how a mature FCPO journal handles the parts that generic
trackers skip: **brokerage plus SST accounting**, and **per-trade journal tags that can be measured**.

Live: https://areppzubaidi.github.io/FCPO-Trading-Tracker/

## The money model

Every number on every screen comes from one function, so no two panels can disagree:

```
FCPO contract             RM25 per point per lot
gross = (exit - entry) * lots * 25        negative for a short that went up
sst   = commission * 8%                   Malaysian service tax on brokerage
net   = gross - commission - sst
```

That SST line is the detail that makes a journal useful for a Malaysian trader and useless for a
generic template: it means the P/L you see is what reached your account, not a paper gain.

## What it does

```
Dashboard    net P/L · win rate · profit factor · expectancy · avg win/loss
             max win streak · max loss streak · max drawdown · brokerage + SST
             account growth curve, drawn as inline SVG (no charting library)
             performance by side, by month, and by journal tag
Blotter      every trade, filterable by side / result / note text, deletable
Journal      tags ranked by net P/L — which behaviour actually costs money
             (VWAP Setup · Stopped out early · Loss Managed · Chased entry · …)
Import       add a trade by hand, import/export JSON, export CSV, load demo data
Statement    paste rows copied from a broker statement or CSV export. Header columns
             matched by name, or positional if there is no header. Handles DD/MM/YYYY,
             YYYY-MM-DD and 06-Oct-26, thousands separators and "RM" prefixes.
             Unreadable rows are listed with the reason — never silently dropped —
             and duplicate fills are detected before anything is written.
Risk         "Perlu berjaga-jaga": 3+ trades in a day, 2 losses in a row, or -2R on the
             day. R is measured against your average loss from prior days, not from the
             day being judged, so a bad day cannot enlarge its own ruler.
```

## What it deliberately is not, yet

```
no PDF statement import    the reference app parses Phillip Capital / Webull / CGS PDFs directly,
                           with a regex set per broker. Yours takes pasted text or CSV, which works
                           with any broker and cannot silently mis-read a commission column. A
                           real PDF parser is worth adding once there is a real statement to
                           build it against.
no backend                 trades live in localStorage. Export before clearing site data.
no multi-account           one account. The reference gates this behind a paid tier.
no auth                    one user. Nothing to protect but your own numbers.
```

## Tests

`test-math.js` runs the real `app.js` in node with a DOM stub and checks the money model against
hand-computed values — contract multiplier, short-side sign, SST applied to commission rather than
P/L, profit factor, streaks, and drawdown measured from the running peak.

```
docker run --rm -v "$PWD":/app -w /app node:16-alpine node test-math.js   → 17 passed
docker run --rm -v "$PWD":/app -w /app node:16-alpine node test-parse.js  → 28 passed
```

Two of these tests failed on first run and both times the implementation was right and the
expectation was wrong — a 2-lot figure checked against a 1-lot input, and an assertion written with
the sign flipped. The third failure was real: R was being measured against an average that included
the losing day, which stopped the -2R limit from ever firing. That one changed the code.

## Roadmap

1. **PDF statement import** — parse a Phillip Capital statement into trades, with statement-date
   detection and a merge that cannot create duplicates. This is the feature that saves real time.
2. **Risk escalation** — flag the 3rd and 4th trade in a session, the point where discipline usually
   goes.
3. **Backend** — Postgres on the homelab K3s cluster, GitOps-deployed, so the journal survives a
   cleared browser and is reachable from the phone.

## Credit

Built after analysing [ceritaduit-journal.vercel.app](https://ceritaduit-journal.vercel.app/), which
established the shape of a serious Malaysian FCPO journal. No code, markup or styling was copied —
this is a from-scratch implementation of the same problem.
