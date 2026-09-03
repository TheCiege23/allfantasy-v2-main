# Known Gaps — append here instead of probing

**Purpose:** record what we don't know so nobody re-probes the API to rediscover it.

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) ·
`RESOLVED` (fixture committed) · `WONTFIX` (doesn't exist / not needed)

---

## Blocking — resolve before shipping a Fleaflicker WeeklyMatchup writer

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | What does `FetchLeagueScoreboard` actually RETURN — envelope, field names, real behaviour? | **PARTIALLY RESOLVED 2026-09-03** — see below | Fleaflicker WeeklyMatchup writer (the whole reason this contract exists — see `lib/fantasy-os/sync/collector/index.ts`'s note) | Split in two by what was actually observed: **(a) the pre-schedule envelope is RESOLVED** — a human (the repo owner) supplied a real test league (`356670`, "Public League 96FCE6"), probed via `./scripts/probe.sh scoreboard NFL 356670 2026` (and again with `scoring_period=1`, byte-identical) — see `fixtures/scoreboard.NFL.json` and `ENDPOINTS.yaml`. **(b) the game/matchup row shape is STILL PROBE_PENDING** — that league was `membershipType: CREATING_COMMISH`, 1 of 12 teams, not yet drafted, so its scoreboard has no games to show, just the schedule-period metadata. Re-run the same probe.sh command once a league (this one, once it fills and drafts, or another) has a real generated schedule. |
| `G-02` | Does `FetchLeagueScoreboard` exist, under that name? | **RESOLVED 2026-09-03** — yes. Confirmed via Fleaflicker's own published Swagger docs (`https://www.fleaflicker.com/api-docs/index.html`), which is reading documentation, not probing the live data API — no league_id was needed for this half. Params: `sport, league_id, season, scoring_period`. A second endpoint, `FetchLeagueBoxscore` (per-matchup detail, keyed by `fantasy_game_id`), was found at the same time — see `ENDPOINTS.yaml`, not currently needed. | — | Resolved; do not re-check. |
| `G-03` | Is the scoreboard scoped by week/period, and what is that param called? | **RESOLVED 2026-09-03** — yes, `scoring_period` (integer), confirmed from the same Swagger docs as G-02. **Further confirmed by the real probe**: it is OPTIONAL (omitting it defaults to the current period — see `ENDPOINTS.yaml` param_types), and `value`/`ordinal` both start at `1` for the season's first week (1-indexed), matching `schedulePeriod`/`eligibleSchedulePeriods` in the real fixture. | — | Resolved; do not re-check. Whether playoff weeks continue the same ordinal sequence or use a different numbering is still open — fold into G-01's remaining half. |
| `G-04` | Team identity on a matchup row — is it the same integer `id` `FetchLeagueStandings`/`FetchLeagueRosters` already use, or a different one? | UNVERIFIED (matchup row still not observed — see G-01). **Partially de-risked**: the real probe of league 356670 confirms `FetchLeagueStandings` and `FetchLeagueRosters` already agree with EACH OTHER on team identity — team "Jetz" is `id: 1840747` in both fixtures. That does not yet prove a *scoreboard* row uses the same id space; only that if it doesn't, it would be the odd one out among three endpoints rather than an even split. | Joining a matchup row back to the `LeagueTeam` rows already written by the standings/rosters import | This is the one field that matters most for correctness. If it's a *different* id space (the way MFL's franchise id and manager id are two different fields for the same team — see this repo's own CLAUDE.md on that exact trap), a matchup writer built on an assumed match would silently misattribute every game. Confirm by eye against a known team from the same league's standings fixture once a game row exists, not by assuming the names line up. |
| `G-05` | What does an unplayed (future) week's scoreboard entry look like — absent, zero-filled, or `null` scores? | **PARTIALLY RESOLVED 2026-09-03, and split into two distinct cases.** (a) A league with NO generated schedule at all (not yet drafted) — `fixtures/scoreboard.NFL.json`, league 356670 — returns NO games key whatsoever, for ANY `scoring_period` value tried; only `schedulePeriod`/`eligibleSchedulePeriods`. This is now the documented behaviour for that case. (b) A specific unplayed-but-scheduled future week WITHIN an otherwise-drafted, active season — the original question this gap was written for — is still UNVERIFIED; league 356670 cannot answer it because it has no schedule to be "future" within. | Placeholder-row convention, matching `lib/rankings-engine/sleeper-matchup-cache`'s existing 0-0-for-unplayed-weeks rule; also the "has this league even drafted yet" check a WeeklyMatchup writer needs before it treats an empty result as an error | For (b): probe a future week in an ACTIVE, drafted league once one is available, and compare against a played week's shape. For (a), a writer should treat a response with no games key as "nothing to write yet," not as a fetch failure. |
| `G-06` | Bye weeks / odd team counts — how does a team with no opponent that week appear? | UNVERIFIED | Correctness of any writer, so a bye isn't miscounted as a 0-0 loss | Needs a league with an odd team count or a real bye-week structure to observe; may not be resolvable from the first probe alone. |

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
