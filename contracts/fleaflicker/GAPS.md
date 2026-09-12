# Known Gaps — append here instead of probing

**Purpose:** record what we don't know so nobody re-probes the API to rediscover it.

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) ·
`RESOLVED` (fixture committed) · `WONTFIX` (doesn't exist / not needed)

---

## Blocking — resolve before shipping a Fleaflicker WeeklyMatchup writer

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | What does `FetchLeagueScoreboard` actually RETURN — envelope, field names, real behaviour? | **RESOLVED 2026-09-11** | Fleaflicker WeeklyMatchup writer | Both halves now observed. (a) pre-schedule envelope: `fixtures/scoreboard.NFL.json` (league 356670, 2026-09-03). (b) **the game/matchup row, which was the outstanding half**: `fixtures/scoreboard.NFL.2021.week1.json` — league `206154`, season **2021** (see the correction note below the table), `scoring_period=1`, HTTP 200, **8 games, all `isFinalScore: true`**. A second played-week fixture, `fixtures/scoreboard.NFL.2021.week16.json` (period 16, championship week), is committed alongside it because its row carries a DIFFERENT flag set. The key is `games`; a row is `{ id, home, away, homeScore, awayScore, homeResult, awayResult, isFinalScore, isDivisional }`, with `home`/`away` carrying the same object shape a standings team does. 🛑 **EVERY `is*` FIELD IS OPTIONAL AND PRESENT ONLY WHEN TRUE** — a false boolean is omitted, so `isFinalScore === false` is never true and an unplayed game must be detected by ABSENCE. Full shape in `ENDPOINTS.yaml`. ⚠ `games` is ABSENT pre-draft, not empty — a writer must read that as "nothing to write yet", never as a fetch failure. |
| `G-02` | Does `FetchLeagueScoreboard` exist, under that name? | **RESOLVED 2026-09-03** — yes. Confirmed via Fleaflicker's own published Swagger docs (`https://www.fleaflicker.com/api-docs/index.html`), which is reading documentation, not probing the live data API — no league_id was needed for this half. Params: `sport, league_id, season, scoring_period`. A second endpoint, `FetchLeagueBoxscore` (per-matchup detail, keyed by `fantasy_game_id`), was found at the same time — see `ENDPOINTS.yaml`, not currently needed. | — | Resolved; do not re-check. |
| `G-03` | Is the scoreboard scoped by week/period, and what is that param called? | **RESOLVED 2026-09-03** — yes, `scoring_period` (integer), confirmed from the same Swagger docs as G-02. **Further confirmed by the real probe**: it is OPTIONAL (omitting it defaults to the current period — see `ENDPOINTS.yaml` param_types), and `value`/`ordinal` both start at `1` for the season's first week (1-indexed), matching `schedulePeriod`/`eligibleSchedulePeriods` in the real fixture. | — | Resolved; do not re-check. Whether playoff weeks continue the same ordinal sequence or use a different numbering is still open — fold into G-01's remaining half. |
| `G-04` | Team identity on a matchup row — is it the same integer `id` `FetchLeagueStandings`/`FetchLeagueRosters` already use, or a different one? | **RESOLVED 2026-09-11 — SAME ID SPACE** | Joining a matchup row back to the `LeagueTeam` rows the standings/rosters import already wrote | Proven by JOIN, not by the shapes looking alike, which is what this row explicitly asked for. All 16 scoreboard team sides from league 206154 / **2021** / week 1 were matched against that same league's own `FetchLeagueStandings` response on **id AND name**: 16/16, zero mismatches. So a WeeklyMatchup writer may join `games[].home.id` / `games[].away.id` directly to `LeagueTeam`. The MFL-style two-id-space trap this row was written to guard against does not apply to Fleaflicker. ⚠ Re-measured 2026-09-11 after the season-label correction: team ids are **stable across seasons** (2019 and 2021 share all 16), and the same sides join 16/16 to BOTH seasons' standings — so this join proves a shared id space but canNOT date a payload. Only `schedulePeriod.low.season` can. |
| `G-05` | What does an unplayed (future) week's scoreboard entry look like — absent, zero-filled, or `null` scores? | **(a) RESOLVED · (b) STILL UNOBSERVED, AND NOT OBSERVABLE FROM LEAGUE 206154** | Placeholder-row convention; the "has this league drafted yet" check | (a) No generated schedule at all ⇒ **no `games` key whatsoever** (`fixtures/scoreboard.NFL.json`). (b) 🛑 **THE 2026-09-11 PROBE DID NOT ANSWER THIS, AND THE FIRST WRITE-UP OF IT WAS WRONG ABOUT WHY.** It said league 206154 "season 2025 week 1" was simply a completed week. The truth is worse: 206154's LAST SEASON IS 2021, every one of its 16 periods is final, and a request for any later season is silently clamped to 2021 — so **no future week of this league can ever be probed, in any season, by anyone.** A follow-up probe of "2026 week 15" returned 2021 week 15. Resolving (b) requires a DIFFERENT league that is mid-season. | 
| `G-05b-inferred` | What the pending shape is EXPECTED to be, marked as inference so nobody cites it as observation | **INFERRED, NOT OBSERVED — do not promote without a fixture** | — | From the proven false-omission rule (see G-01): an unplayed game should carry **no `isFinalScore` key at all**, rather than `isFinalScore: false`. Whether its `homeScore`/`awayScore` are absent, `{}`, or zero-valued is **genuinely unknown** and is NOT derivable from the omission rule, because `0` is itself a default that may be omitted. `lib/import-os/collector/fleaflickerMatchupParity.ts` is written to be correct under all three readings — see its header. |
| `G-06` | Bye weeks / odd team counts — how does a team with no opponent that week appear? | **STILL UNVERIFIED** — and the 2026-09-11 probe could not answer it | Correctness of any writer, so a bye isn't miscounted as a 0-0 loss | League 206154 has **16 teams playing 8 games**: every team has an opponent, so no bye can appear. Needs a league with an ODD team count, or a real bye structure. ⚠ Recorded rather than left to look answered-by-association because the same probe resolved G-01 and G-04 — a fixture resolving some gaps does not resolve the ones it happens not to contain. |

---

## Open — needs a decision from the repo owner, not more probing

### `G-07` — whose league's transactions may be committed as a fixture?

`FetchLeagueActivity`, `FetchLeagueTransactions` and `FetchTrades` are DISCOVERED
(names from the vendor's published Swagger docs, 2026-09-12) and NOT CAPTURED.
They are the remaining blocker on the "activity" third of the import audit's P2
item 1.

🛑 **THE OBSTACLE IS PRIVACY, NOT DIFFICULTY, AND IT IS NOT THE PROBE'S CALL.**
These endpoints return a log of real people's roster moves — who dropped whom,
and when. This repository is PUBLIC. A scoreboard's team names are already
public-facing in a way a per-manager activity log is not, and `scripts/probe.sh`
has carried a warning about publishing real league data since it was written.

Capturing standings/rosters/scoreboard/rules for league 206154 added no new
exposure, because that league's data was already committed and those payloads are
league configuration and results. An activity log is a different kind of record.

**What would resolve it:** the repo owner naming a league whose transaction
history they are content to publish — ideally one they own. Until then the
endpoints stay recorded-but-uncaptured, which is the honest state: we know they
exist and what they take, and we have not looked inside.

⚠ **AND `FetchTrades`'s `filter` PARAMETER IS UNDOCUMENTED.** The vendor names the
parameter without enumerating its accepted values. Guessing one and probing is
exactly the assumption this contract exists to prevent; it needs the same
docs-or-ask treatment the endpoint names got.

---

## Not gaps — already known from the existing, working integration

Recorded here so nobody re-derives them by probing `FetchLeagueStandings` or
`FetchLeagueRosters` again. See `ENDPOINTS.yaml` for the full shape of both.

- No auth of any kind is required for any Fleaflicker endpoint used so far.
- `sport` must be one of `NFL, MLB, NBA, NHL` — this is this codebase's own accepted set
  (`parseFleaflickerSourceId`), not necessarily Fleaflicker's full sport list.
- 404 means "no such league," distinguished from other error statuses already.
- 🛑 **`season` PAST THE LEAGUE'S LAST IS SILENTLY CLAMPED TO THE LAST SEASON AND RETURNS
  THAT SEASON'S COMPLETE, PLAYED DATA UNDER HTTP 200.** This RETRACTS the bullet that stood here
  until 2026-09-11, which said such a season "returns a normal (if sparse) envelope". The
  envelope is normal; the data is another season's, which is the dangerous part. Measured on
  league 206154 (last season 2021): `season=` 2021, 2024, 2025, 2026 and **2099** all returned
  byte-identical games — same eight ids, same finals. Within range it IS honoured (2019, 2020,
  2021 each differ). And `FetchLeagueStandings` echoes the REQUESTED season back in its
  top-level `season` field, so reading that to learn what you got is circular.
  **`schedulePeriod.low.season` is the only authority.** A sync that trusts the request would
  persist 2021 finals as the current week's results on any dormant league.
- A pre-draft team (league not yet drafted) is a normal, non-error `FetchLeagueRosters` response
  with an empty `players` array on that team's roster — not a shape to special-case as broken.
  Confirmed 2026-09-03 against league 356670. See `ENDPOINTS.yaml`'s `FetchLeagueRosters` note.

---

### `G-08` — which endpoints reject `season`, beyond the two we have seen 400 on?

**Status:** `UNVERIFIED` for `FetchLeagueTransactions` and `FetchTrades`.

The 2026-09-12 real-league audit established that `FetchLeagueRules` and
`FetchLeagueActivity` return **HTTP 400** when `season` is included, and 200 when
it is omitted. `ENDPOINTS.yaml` now records `season` as `required: per-endpoint`
rather than `required: true`, with `accepted_by` / `rejected_by` / `unknown_for`
lists.

🛑 **THE POINT OF THIS ENTRY IS THE `unknown_for` LIST.** `FetchLeagueTransactions`
and `FetchTrades` were never probed either way. They *look* like activity — no
`season` in their documented `params`, paging by `result_offset` — so the obvious
inference is that they 400 too. **That inference is exactly what this file exists
to stop being made silently.** Their absence from `params` is evidence they do not
*need* `season`; it is not evidence of what happens if you send one.

⚠ **This gap is cheap to resolve and expensive to guess at, in an asymmetric way.**
Guess "accepted" and you get a 400 the existing client reports as a generic API
error, so the cause is invisible. Guess "rejected" and nothing breaks — which is
why the safe default is already encoded: build the query from `params:`.

**What would resolve it:** one probe each, with and without `season`, recording
only the status code. ⚠ That needs no fixture and therefore does **not** require
G-07's privacy decision — a status code is not a transaction log. Note the two
gaps are independent: G-07 blocks *capturing a body*, G-08 needs only a number.

**Not resolved by re-reading the Swagger docs.** Documentation lists the
parameters an endpoint takes; it does not say whether an extra one is ignored or
rejected. The 400 was found by a live request, and the docs had already been read
twice by then without revealing it.

---

### `G-09` — Fleaflicker exposes NO playoff setting, on any captured endpoint

**Status:** `RESOLVED` as a question about the API — the answer is "it isn't there."
`WONTFIX` as an import, until a bracket exists.

The import audit's P1 item 14 reported the playoff count as "guessed instead of
imported", which is half right and the other half matters: it **was** guessed —
`FleaflickerAdapter` computed `Math.max(2, Math.floor(leagueSize / 2))` — but
there is nothing to import it from.

Measured against the committed fixtures, not asserted:

| endpoint | fixture | playoff-related leaf paths |
|---|---|---|
| `FetchLeagueRules` | `rules.NFL.json`, 67KB | **0** |
| `FetchLeagueStandings` | `standings.NFL.json` (`league` object, 22 leaves) | **0** |
| `FetchLeagueScoreboard` | `scoreboard.NFL.2021.week1.json` | 0 games flagged |
| `FetchLeagueScoreboard` | `scoreboard.NFL.2021.week16.json` | 2 of 4 games `isPlayoffs` |

🛑 **THE ONLY PLAYOFF EVIDENCE FLEAFLICKER EXPOSES IS PER-GAME, AND ONLY ONCE THE
BRACKET IS SCHEDULED.** For a league mid-regular-season the count is genuinely
unknown. The adapter now sends `undefined`, matching ESPN, MFL and Fantrax, all of
which already say "unknown" when their provider is silent. Fleaflicker was the
only adapter inventing a value.

⚠ **Why the invention was dangerous rather than untidy.** A 12-team league got 6 —
the single most common real answer — so it was invisible in exactly the leagues
anyone would have checked. And `lib/data/league-home.ts` does
`standings.slice(0, playoff.playoff_team_count)` to seed a bracket, so a league
that takes 4 or 8 rendered a six-team playoff picture derived from its roster
count and nothing else.

🛑 **`recordPostseason` IS THE TRAP, AND IT LOOKS EXACTLY LIKE THE ANSWER.** Every
team object carries one, so "teams with a non-zero postseason record made the
playoffs" is the obvious derivation. It counts **consolation** games: in the
week-16 fixture the two consolation games' four teams carry 1-1, 2-0, 2-1 and 1-2.
That heuristic returns the whole playing field, not the playoff field. A regression
test pins this.

**What a real import would take,** if someone wants the count for a COMPLETED
season: union the distinct teams across every scoring period whose scoreboard has
any `isPlayoffs: true` game. ⚠ One week is not enough — week 16 of the fixture
league shows only 4 teams in playoff games, because the earlier round has already
eliminated some; a six-team bracket with two byes looks like four teams if you read
the wrong week. That is N extra scoreboard requests per league per season and it
still answers nothing for a league whose playoffs have not started, which is why it
was not built here.
