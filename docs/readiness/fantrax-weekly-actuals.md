# Fantrax weekly actual-score ingestion

This is an operator fallback and validation tool, not a weekly user requirement.
Fantrax public fxea responses currently supply period rosters and team totals;
the captured responses do not supply individual actual points. The roster export
button does not expose a copyable link. A production background individual-score
collector is not enabled until an authenticated or public download contract is
verified. Do not guess private fxpa parameters or request user cookies.

## Bulk import

Run `scripts/import-fantrax-weekly-actuals.ts --manifest=PATH` through tsx with the
repository server conditions. Default is dry-run. Explicit `--apply` writes only
`LeaguePlayerWeeklyScore` source='fantrax', scoped to the imported snapshot UUID,
season and period. It does not modify global stats, fantasyPoints, team totals,
winners or native standings. A timestamped before-image is saved beside the
manifest before writes. Finalized rows and conflicting sources abort the batch.
All rows must validate before the transaction begins; a later conflict rolls
back every score and receipt in the batch. Identical score rows are no-ops.

Manifest structure:

```json
{"leagueId":"ALLFANTASY_LEAGUE_UUID","season":2026,"exports":[
  {"period":4,"sourceTeamId":"FANTRAX_TEAM_ID","path":"actual-stats.csv"}
]}
```

CSVs do not encode their selected season/week. Therefore the importer fetches
independent Fantrax league calendar, exact period rosters and team scores. It
requires completed periods, exact roster membership/status, unique player IDs,
raw statistical category headers, final opponents or byes, finite points and
matching starter sums. Wrong season, projections, cumulative totals, missing
players and ambiguous mappings fail closed. Current numeric LeagueTeam IDs are
used; stale legacy slug duplicates do not qualify as mappings. Hashes and row
counts are recorded per team/period, so partial imports do not erase prior
period coverage. Rows remain unfinalized pending a correction reconciliation.

Matchup evidence labels individual actuals available only when both teams have
verified receipts for that exact period. Calculated points remain a separate
value; missing calculations are not interpreted as zero.

## Cream Bowl evidence

The supplied week-4 and week-5 exports verified 24 team-periods and 932 player
rows, including reserves. Week 4 has 120/120 matching active-player calculations;
week 5 has 119/120. All 24 exported starter totals match Fantrax's team totals.
The only active-player difference is Jackson Arnold: source 49.88 versus
CFBD-derived 50.08. CFBD reports 177 passing yards; ESPN and UNLV's official
box score report 172. No provider stat override was applied.

Official box score: https://unlvrebels.com/sports/football/stats/2026/cal/boxscore/17829

Regression tests cover malformed points, negative and zero actuals, stale lineup
status, omitted/duplicate players, projections, source-total mismatch, missing
calculations and period-specific availability.

## Remaining automation work

Obtain a supported individual-score data contract and authentication model,
then feed the same verifier through a bounded ingestion job with retries and
correction reconciliation. Existing roster/team-total sync remains automatic.
This CLI does not make private downloads automatic or claim all-season parity.

## Background discrepancy reconciliation

The existing Fantrax matchup collector now runs a DB-first comparison sidecar
for NCAAF leagues. It compares the two latest completed periods with imported
source actuals, bounded at 1,000 starters and 10,000 provider rows per period.
It uses the imported league rules and preserved TE position premium. No sports
provider call occurs on the read path, and no score or stat is rewritten.

Reports are stored as `fantrax-scoring-parity:LEAGUE:SEASON:PERIOD`, retaining
source actual points, calculated points, deltas, provider sources and missing
calculations. Source-sync results expose compared/discrepancy/gap counts and
sidecar errors. A sidecar failure does not undo successful source-result sync.
Missing identities or provider game rows (including unverified byes) remain
coverage gaps, never automatic zeros or confirmed matches.

Cream Bowl initial DB readback: 228 calculable starters across the two periods,
one discrepancy and 12 provider-row/identity coverage gaps. The separate CSV
stat-line validation establishes 239/240 active-player matches, including
zero-point rows. These are different evidence scopes; do not conflate them.
