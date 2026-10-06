# CFBD additional scoring verification

Authorized October 5, 2026. Both fixtures were captured through scripts/probe.sh and are committed with this contract.

## Captured and verified

- `/plays/stats/types`: 26 entries. `/plays/stats?gameId=401856695`: 212 associations, spanning all four periods, below the documented 2,000-row ceiling.
- The field-goal `stat` is distance, not count: Kanoah Vinesett has one attempt and one make, each with value 24. The official NC State box score confirms one 24-yard field goal. Count distinct player/play associations; never sum `stat` as the number of makes.
- Being nonempty and below the ceiling proves neither complete player coverage nor complete scoring coverage.

## Open data gaps

- The directory contains no explicit two-point-conversion, assisted-tackle or safety type. Absence cannot be scored as a verified zero.
- The official NC State report credits Aguirre with a forced fumble preceding Vinesett's field goal. The captured play stats contain only one `Fumble Forced` association, for Vanderbilt's Cayden Daniels at the end of the game. Therefore this endpoint is demonstrably incomplete for forced-fumble totals in this game. Do not replace verified box-score totals with its IDP event sums.
- Team-defense totals are not supplied by this athlete association endpoint.
- Field-goal distance is a verified observation, but runtime distance scoring still requires complete made/attempt reconciliation against each game's verified box score and an audited scoring-rule bridge. No broad scoring feed is enabled from this single capture.

Sources: [CFBD API reference](https://api.collegefootballdata.com/api/plays), [official box score](https://gopack.com/sports/football/stats/2026/vanderbilt/boxscore/24539), [official game report](https://gopack.com/news/2026/9/19/football-wolfpack-falls-to-vanderbilt-on-last-second-touchdown).
