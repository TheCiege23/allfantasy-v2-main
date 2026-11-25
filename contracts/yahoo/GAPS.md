# Yahoo contract — gaps and decisions

Nothing is captured yet. Every item below is **awaiting the owner's capture** from the admin
button (README). Do not probe to resolve any of them.

## Open — awaiting owner capture (2026-11-25)

- `Y-01` OPEN: the per-player weekly points shape. No committed capture shows
  `team/{key}/roster;week=N/players/stats;type=week;week=N` — whether bench players carry
  `player_points` for the week, whether the total is the league's own scoring, and the exact
  nesting of `selected_position` vs the stats block. Blocks a Yahoo writer for
  `league_player_weekly_scores` and so Yahoo bench grading. **Needed:** the owner's capture of a
  FINISHED week.
- `Y-02` OPEN: `league/{key}/scoreboard;week=N` for a finished week — team totals and matchup
  status values. `fetchYahooCategoryMatchupForWeek` already parses it with no fixture behind it.
- `Y-03` OPEN (shape) / DECIDED (privacy): pending trade offers
  (`transactions;types=pending_trade;team_key=`). `scanPendingYahooTrades` already reads them;
  the status vocabulary, whether a proposer is named (the scanner assumes not) and the trade-note
  field are uncaptured.

## Decision — pending trade offers are private to the people in them (owner, 2026-11-25)

**AllFantasy may read pending trade offers, but must keep and show ONLY offers the signed-in user
sent or received.** An offer between two other managers in the same league is not shown to, or
kept for, anyone else — not to the commissioner, not to league-mates, not in an aggregate.

- Applies to Yahoo, ESPN (`contracts/espn/GAPS.md` T-03) and Fleaflicker
  (`contracts/fleaflicker/GAPS.md` G-07) alike.
- Yahoo already reads with `team_key=` set to the reader's own team, and the scanner re-checks
  `teamKeys.includes(teamKey)`; keep both.
- A capture committed to `fixtures/` is redacted (names, guids, team names, league key) and holds
  only the capturing owner's own offers.
