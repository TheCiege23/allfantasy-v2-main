# contracts/api-sports

Partial contract for **API-Sports American Football v1**
(`https://v1.american-football.api-sports.io`), created 2026-09-08.

This is **not** a full contract like `contracts/rolling-insights/` or
`contracts/thesportsdb/` — there is no `ENDPOINTS.yaml` and no `GAPS.md` yet. It
exists because the root CLAUDE.md rule for probing is that *"the captured fixture
must be committed in the same change"*, and one probe was run.

## 🛑 College injuries: API-Sports publishes none. Do not build a college sweep.

Probed 2026-11-22 with `scripts/probe.sh`, on the **Ultra** plan (75,000/day,
active, per the free `/status` call). `/injuries?team=<id>` for five of the biggest
FBS programs returned **HTTP 200, `errors: []`, 0 results** each, while the NFL
control on the same key in the same minute returned rows:

| team | id | results | fixture |
|---|---:|---:|---|
| Ohio State | 107 | 0 | `injuries-ncaaf-team-107.json` |
| Alabama | 106 | 0 | `injuries-ncaaf-team-106.json` |
| Michigan | 115 | 0 | `injuries-ncaaf-team-115.json` |
| Texas | 195 | 0 | `injuries-ncaaf-team-195.json` |
| LSU | 207 | 0 | `injuries-ncaaf-team-207.json` |
| **NFL control:** Jacksonville | 2 | **17** | `injuries-nfl-team-2.json` |

Ravens (5) and Lions (7) returned 13 and 20 in the same run and were not kept.
⚠ Raiders (1) returned **0**: a single NFL team is not a control, because a team
can genuinely have nobody listed. Use one known to carry injuries.

**Why this is "no data" and not "not entitled":** this vendor reports a plan refusal
as a populated `errors` object (`errors.plan`), and these responses carry none. The
key does reach college for other endpoints: 5,508 NCAAF 2026 games and their scores
come through it (`SportsGame`, `source = 'api_sports'`).

**What it would have cost to learn this the slow way:** API-Sports carries 726
college teams. The bounded list was the FBS: 138 teams in the stored NCAAF
standings, 137 resolvable to an API-Sports id by school name (`SportsGame.homeTeamId`),
Buffalo excluded because id 141 carries both FBS Buffalo's MAC schedule and
Division III Buffalo State's. A per-team sweep of that list is ~137 calls a run that
would have written nothing and reported success. NCAAF injuries need another source.

## `scripts/probe.sh`

One request per run, written to `fixtures/<name>.json`, after a `/status` call that
reports the key's plan (that call does not count against the quota). The key goes in
the `x-apisports-key` header through a 0600 temp file (`curl -H @file`), so it is in
neither the URL nor any process's argv, and it is never printed. `/status`'s account
name and email are discarded. JSON is parsed with `node -e` because `jq` is not
installed in this repo's Git Bash.

```bash
export API_SPORTS_KEY="$(grep -m1 '^API_SPORTS_KEY=' .env.local | cut -d= -f2- | tr -d '\r"')"
contracts/api-sports/scripts/probe.sh injuries-nfl-team-2 injuries team=2
```

Exit 3 means the response carried a populated `errors` object, since API-Sports
answers HTTP 200 for those.

It is a shell script rather than `.mjs` on purpose: `scripts/check-db-first-api-boundary.mjs`
scans `.mjs` files, and a capture tool is not a request path.

## Why the probe was run, and why reading the docs was not enough

The vendor documentation was read first. It pins the request envelope — `/odds`
takes a **required** `game` id plus optional `bookmaker` and `bet`, prices exist
1–7 days pre-match with a 7-day history, updated four times a day — but **every
response sample in it is collapsed**. Not one literal `bets[].name` string appears
anywhere in the docs, and the committed `APISportsOdds` interface types the field
as a bare `string`.

`lib/odds/normalizeApiSportsOdds.ts` has to decide which market a bet *is*. That
decision cannot be made from a type of `string`.

## `fixtures/odds-bets.json`

A verbatim capture of `GET /odds/bets` (one request, HTTP 200).

**It contains 361 markets. The documentation's sample implies 78.**

Measuring the normalizer's original substring aliases against this list is what
condemned them:

| alias | live markets matched | how many are the intended market |
|---|---|---|
| `'total'` | **59** | 1 (`Over/Under`) |
| `'handicap'` | 5 | 1 (`Asian Handicap`) — also caught `Handicap Result`, a 3-way |
| `'2-way'` | — | 0 — caught `Team To Make First Score 2-Way` |

The 58 false positives include `Total Passing Yards` (~520), `Total Touchdowns`
(~5.5), `Total Field Goals` (~3.5), `Total Punts`, `Total Sacks`, and
`Total - Home` / `Total - Away` (team totals, not the game's). Any of them would
have been written into `total_points` as a number of the right type and the wrong
meaning — and would **not** have appeared in the `unrecognized_bets` diagnostic,
because they were wrongly *recognised*.

So the normalizer now classifies on the **bet id**, which the docs state is stable
and usable as a filter:

| id | name | market |
|---|---|---|
| 1 | `Home/Away` | moneyline |
| 2 | `Asian Handicap` | spread (2-way) |
| 3 | `Over/Under` | game total |

⚠ Two things in this fixture worth knowing before writing code against it, both
counted from the file rather than eyeballed:

- **id 86 has a `name` of literally `null`** — the only such entry. Guard the name
  before using it.
- **40 names are duplicated across different ids.** `Home Total Touchdowns (3W)` is
  ids 152 and 153; `Total Touchdowns` is ids 54 **and 338**; `Total Field Goals` is
  75 and 337. So a name does not identify a market even within this one list, which
  is the second reason the id is the key.

  The three primaries are each unique (`Home/Away`→1, `Asian Handicap`→2,
  `Over/Under`→3), which is what makes the exact-name fallback safe to keep as a
  backstop against renumbering.

## Regenerating

One request against `/odds/bets` with an `x-apisports-key` header. It is not
tied to a season or a game, so it is stable and rarely needs recapturing. The
`/status` endpoint is the cheapest way to confirm a key works first — it reports
plan and remaining quota and **does not count against the daily quota**.
