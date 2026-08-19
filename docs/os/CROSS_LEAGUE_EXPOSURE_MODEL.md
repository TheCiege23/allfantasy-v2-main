# Cross-League Exposure Model

Date: 2026-07-13. Documents Part 9 — how `exposure` is computed on every
`CrossLeaguePlayerPortfolioItem`.

## The real computation

```
exposure.leagueCount              = distinct canonicalLeagueId count across this player's rows
exposure.rosterCount               = total roster-row count (can exceed leagueCount only if a
                                      provider somehow lists a player twice in one roster —
                                      never happens in practice given getNormalizedLineupSections'
                                      own de-duplication, but the field is not artificially capped)
exposure.starterCount / benchCount
  / injuredReserveCount / taxiCount = real per-section counts, summed across every league appearance
exposure.percentageOfUserLeagues   = leagueCount / connectedLeagueCount (the user's REAL total
                                      connected-league count, from the same real roster query —
                                      never a fabricated denominator)
```

`connectedLeagueCount` is computed once, from the real, deduplicated set
of `Roster.leagueId` values returned for the user's linked platform ids —
the same real denominator every player's `percentageOfUserLeagues` is
measured against, so percentages are comparable across the whole
portfolio.

## Why no fabricated diversification advice

The phase brief's guardrail: "Do not imply diversification is always
optimal." This module's `exposure` object is descriptive only — a real
count and a real percentage, never a prescriptive "you should diversify"
message. The `getChimmyCrossLeaguePlayerSummary()` seam does surface an
`overexposedPlayers` list (real threshold: `percentageOfUserLeagues >=
0.5` AND `leagueCount > 1`, so a player in a user's only league never
gets flagged), but its output is a factual list, not an editorialized
recommendation — consistent with every other domain generator in this
program's established content policy (state the real fact, let the
consumer surface it however they choose).

## What's deferred

Position/professional-team/injury/bye-week *concentration* (as distinct
aggregate reports — "you have 4 RBs on bye this week," "you have 3
players on the same NFL team") are real, disclosed deferrals this phase.
The underlying per-item fields (`position`, `professionalTeam`,
`schedule.byeWeek`) are all real and already present on every portfolio
item — a future phase can build these aggregate views by grouping the
existing `items` array client-side or server-side without needing any new
data source. This phase deliberately did not build that aggregation layer
itself, favoring the smaller, genuinely-computed leagueCount/percentage
signal over a wider set of shallow concentration reports.

## Low-sample handling

A user connected to exactly one league will have every rostered player at
`percentageOfUserLeagues: 1` and `leagueCount: 1` — real, correct, and
never flagged as "overexposed" by the Chimmy seam's `leagueCount > 1`
guard, since a single-league user has no real diversification choice to
make.
