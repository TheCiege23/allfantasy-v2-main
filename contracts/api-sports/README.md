# contracts/api-sports

Partial contract for **API-Sports American Football v1**
(`https://v1.american-football.api-sports.io`), created 2026-09-08.

This is **not** a full contract like `contracts/rolling-insights/` or
`contracts/thesportsdb/` — there is no `ENDPOINTS.yaml` and no `GAPS.md` yet. It
exists because the root CLAUDE.md rule for probing is that *"the captured fixture
must be committed in the same change"*, and one probe was run.

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
