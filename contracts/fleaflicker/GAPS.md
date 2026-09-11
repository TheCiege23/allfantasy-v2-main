# Known Gaps — append here instead of probing

**Purpose:** record what we don't know so nobody re-probes the API to rediscover it.

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) ·
`RESOLVED` (fixture committed) · `WONTFIX` (doesn't exist / not needed)

---

## Blocking — resolve before shipping a Fleaflicker WeeklyMatchup writer

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | What does `FetchLeagueScoreboard` actually RETURN — envelope, field names, real behaviour? | **RESOLVED 2026-09-11** | Fleaflicker WeeklyMatchup writer | Both halves now observed. (a) pre-schedule envelope: `fixtures/scoreboard.NFL.json` (league 356670, 2026-09-03). (b) **the game/matchup row, which was the outstanding half**: `fixtures/scoreboard.NFL.week1.json` — league `206154`, season 2025, `scoring_period=1`, HTTP 200, **8 games, all `isFinalScore: true`**. The key is `games`; a row is `{ id, home, away, homeScore, awayScore, homeResult, awayResult, isFinalScore, isDivisional }`, with `home`/`away` carrying the same object shape a standings team does. Full shape in `ENDPOINTS.yaml`. ⚠ `games` is ABSENT pre-draft, not empty — a writer must read that as "nothing to write yet", never as a fetch failure. |
| `G-02` | Does `FetchLeagueScoreboard` exist, under that name? | **RESOLVED 2026-09-03** — yes. Confirmed via Fleaflicker's own published Swagger docs (`https://www.fleaflicker.com/api-docs/index.html`), which is reading documentation, not probing the live data API — no league_id was needed for this half. Params: `sport, league_id, season, scoring_period`. A second endpoint, `FetchLeagueBoxscore` (per-matchup detail, keyed by `fantasy_game_id`), was found at the same time — see `ENDPOINTS.yaml`, not currently needed. | — | Resolved; do not re-check. |
| `G-03` | Is the scoreboard scoped by week/period, and what is that param called? | **RESOLVED 2026-09-03** — yes, `scoring_period` (integer), confirmed from the same Swagger docs as G-02. **Further confirmed by the real probe**: it is OPTIONAL (omitting it defaults to the current period — see `ENDPOINTS.yaml` param_types), and `value`/`ordinal` both start at `1` for the season's first week (1-indexed), matching `schedulePeriod`/`eligibleSchedulePeriods` in the real fixture. | — | Resolved; do not re-check. Whether playoff weeks continue the same ordinal sequence or use a different numbering is still open — fold into G-01's remaining half. |
| `G-04` | Team identity on a matchup row — is it the same integer `id` `FetchLeagueStandings`/`FetchLeagueRosters` already use, or a different one? | **RESOLVED 2026-09-11 — SAME ID SPACE** | Joining a matchup row back to the `LeagueTeam` rows the standings/rosters import already wrote | Proven by JOIN, not by the shapes looking alike, which is what this row explicitly asked for. All 16 scoreboard team sides from league 206154 / 2025 / week 1 were matched against that same league's own `FetchLeagueStandings` response on **id AND name**: 16/16, zero mismatches. So a WeeklyMatchup writer may join `games[].home.id` / `games[].away.id` directly to `LeagueTeam`. The MFL-style two-id-space trap this row was written to guard against does not apply to Fleaflicker. |
| `G-05` | What does an unplayed (future) week's scoreboard entry look like — absent, zero-filled, or `null` scores? | **PARTIALLY RESOLVED — (a) resolved, (b) STILL UNVERIFIED** | Placeholder-row convention; the "has this league drafted yet" check | (a) No generated schedule at all ⇒ **no `games` key whatsoever** (`fixtures/scoreboard.NFL.json`). (b) A scheduled-but-unplayed FUTURE week inside an active season is **still unobserved** — and the 2026-09-11 probe did not answer it either: league 206154 season 2025 week 1 is a COMPLETED week (all 8 games `isFinalScore: true`), so it shows the played shape, not the pending one. ⚠ Do not infer the pending shape by negating the played one. Probe a future week of an in-progress season. |
| `G-06` | Bye weeks / odd team counts — how does a team with no opponent that week appear? | **STILL UNVERIFIED** — and the 2026-09-11 probe could not answer it | Correctness of any writer, so a bye isn't miscounted as a 0-0 loss | League 206154 has **16 teams playing 8 games**: every team has an opponent, so no bye can appear. Needs a league with an ODD team count, or a real bye structure. ⚠ Recorded rather than left to look answered-by-association because the same probe resolved G-01 and G-04 — a fixture resolving some gaps does not resolve the ones it happens not to contain. |

---

## Not gaps — already known from the existing, working integration

Recorded here so nobody re-derives them by probing `FetchLeagueStandings` or
`FetchLeagueRosters` again. See `ENDPOINTS.yaml` for the full shape of both.

- No auth of any kind is required for any Fleaflicker endpoint used so far.
- `sport` must be one of `NFL, MLB, NBA, NHL` — this is this codebase's own accepted set
  (`parseFleaflickerSourceId`), not necessarily Fleaflicker's full sport list.
- 404 means "no such league," distinguished from other error statuses already.
- `season` accepts a year with no data and returns a normal (if sparse) envelope rather than
  erroring.
- A pre-draft team (league not yet drafted) is a normal, non-error `FetchLeagueRosters` response
  with an empty `players` array on that team's roster — not a shape to special-case as broken.
  Confirmed 2026-09-03 against league 356670. See `ENDPOINTS.yaml`'s `FetchLeagueRosters` note.
