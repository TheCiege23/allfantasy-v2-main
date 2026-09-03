# Known Gaps — append here instead of probing

**Purpose:** record what we don't know so nobody re-probes the API to rediscover it.

**Status values:** `UNVERIFIED` (never probed) · `PROBE_PENDING` (queued for next capture) ·
`RESOLVED` (fixture committed) · `WONTFIX` (doesn't exist / not needed)

---

## Blocking — resolve before shipping a Fleaflicker WeeklyMatchup writer

| ID | Gap | Status | Blocks | How to resolve |
|---|---|---|---|---|
| `G-01` | What does `FetchLeagueScoreboard` actually RETURN — envelope, field names, real behaviour? | **PROBE_PENDING** — path and params are now confirmed (see below), the response body is not | Fleaflicker WeeklyMatchup writer (the whole reason this contract exists — see `lib/fantasy-os/sync/collector/index.ts`'s note) | `./scripts/probe.sh scoreboard NFL <league_id> <season> <scoring_period>` against a real, currently-active league. Requires a real `league_id` — this codebase has none on file (checked: no test, fixture, or doc references a real Fleaflicker league id). **Needs a human to supply one**, per the same reasoning `README.md`'s privacy note gives: prefer probing a league your own account can see over a random public one. |
| `G-02` | Does `FetchLeagueScoreboard` exist, under that name? | **RESOLVED 2026-09-03** — yes. Confirmed via Fleaflicker's own published Swagger docs (`https://www.fleaflicker.com/api-docs/index.html`), which is reading documentation, not probing the live data API — no league_id was needed for this half. Params: `sport, league_id, season, scoring_period`. A second endpoint, `FetchLeagueBoxscore` (per-matchup detail, keyed by `fantasy_game_id`), was found at the same time — see `ENDPOINTS.yaml`, not currently needed. | — | Resolved; do not re-check. |
| `G-03` | Is the scoreboard scoped by week/period, and what is that param called? | **RESOLVED 2026-09-03** — yes, `scoring_period` (integer), confirmed from the same Swagger docs as G-02. | — | Resolved; do not re-check. What VALUES that param takes for a given season (1-indexed? does it include playoffs?) is still open — fold into G-01's fixture work. |
| `G-04` | Team identity on a matchup row — is it the same integer `id` `FetchLeagueStandings`/`FetchLeagueRosters` already use, or a different one? | UNVERIFIED | Joining a matchup row back to the `LeagueTeam` rows already written by the standings/rosters import | This is the one field that matters most for correctness. If it's a *different* id space (the way MFL's franchise id and manager id are two different fields for the same team — see this repo's own CLAUDE.md on that exact trap), a matchup writer built on an assumed match would silently misattribute every game. Confirm by eye against a known team from the same league's standings fixture, not by assuming the names line up. |
| `G-05` | What does an unplayed (future) week's scoreboard entry look like — absent, zero-filled, or `null` scores? | UNVERIFIED | Placeholder-row convention, matching `lib/rankings-engine/sleeper-matchup-cache`'s existing 0-0-for-unplayed-weeks rule | Probe a week that hasn't happened yet in the same league, once a real one is available, and compare against a played week's shape. |
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
