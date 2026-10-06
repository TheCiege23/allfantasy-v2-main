# Cream Bowl scoring fixes 1–3

Verified 2026-10-06T21:30:03.143Z; 2026 completed scoring period 4. Historical source lineups: 12 teams, 120 starters. Production imported scores and matchup results were not rewritten.

## Delivered changes

1. **Winston Watkins Jr. identity:** reviewed Fantrax 06u8g, LSU WR, CFBD 5141697 replaces the proven wrong William & Mary QB link 5226917. The guarded repair validates owned league scope, source ID/name/position/school, provider proof, unique ownership in both directions, and an optimistic concurrency condition under the existing identity advisory lock. It defaults to a dry run, backs up affected records locally before writing, and writes only cfbdId/lastSyncedAt. Applied one identity change; the subsequent run proposed zero changes.
2. **Imported scoring rules:** a source-specific NCAAF bridge reads scoringSettings.rules and disables categories absent from the source schedule. It honors six-point passing touchdowns, one-point receptions, and the additive 0.5 TE reception bonus; no default interception or fumble-loss penalties leak into this league. Explicit canonical scoring configuration and commissioner-saved panel edits keep their existing precedence. Unsaved seeded panel defaults do not replace imported source rules. Invalid source weights fail explicitly. Other sports/providers are unaffected.
3. **Return touchdowns:** CFBD kickReturns.TD and puntReturns.TD now normalize to distinct kr_td/pr_td counts. Independent league weights apply once per return; the native panel's combined return-TD rule supplies both separate weights. The generic NCAAF sport adapter also preserves the return and premium fields, so intermediate parsing cannot drop them. Unknown return stat keys are diagnosed rather than silently ignored. Return yards, attempts, averages, and longs are not treated as touchdowns. Missing counts remain missing; explicit zeros remain zeros.

The commissioner NCAAF panel also displays mapped imported weights, including the TE bonus, so saving the displayed rules preserves this scoring. The original inferred half-PPR template label is no longer used as this panel's scoring description.

## Completed-period rerun

| Team | Fantrax actual | Independent calculation | Remaining gap |
|---|---:|---:|---:|
| Yourdyinggrandpa | 146.64 | 146.64 | 0.00 |
| Ciege82 | 214.64 | 214.64 | -0.00 |
| Grindingffb | 145.94 | 145.94 | 0.00 |
| Scorescotty | 143.52 | 143.52 | 0.00 |
| Team JMasc | 168.38 | 168.38 | -0.00 |
| Georgia Bulldogs | 185.84 | 183.84 | 2.00 |
| loganhall | 196.52 | 196.52 | 0.00 |
| TQ Trojans | 208.82 | 208.82 | -0.00 |
| Connor0488 | 145.58 | 145.58 | 0.00 |
| rfasti | 127.74 | 127.74 | -0.00 |
| Jws452 | 251.38 | 251.38 | 0.00 |
| king gustov | 163.16 | 163.16 | 0.00 |

- **11/12 independent team totals match exactly within floating-point tolerance.**
- **6/6 matchup winners match.** The former Grindingffb/Scorescotty winner reversal is fixed.
- **82/82 available basic offensive stat values match**; two Fantrax category values are unavailable and are not claimed as verified zeros.
- Team JMasc's six-point Bryant Wesco Jr. punt-return touchdown is included.
- Georgia Bulldogs' remaining two points are the independently unattributed rushing/receiving two-point conversion from item 4. No player stat was invented to close that gap.
- All 12 stored TeamPerformance scores remain equal to their Fantrax actuals. This calculation exercises the modified code against fresh production player-game data; deployment status must be verified separately.

## Identity evidence

[LSU official 2026 roster](https://lsusports.net/sports/fb/roster/player/winston-watkins-jr) identifies Winston Watkins Jr. as the LSU receiver. [William & Mary official 2026 roster](https://tribeathletics.com/sports/football/roster/winston-watkins/19350) identifies the namesake quarterback. [LSU September 26 recap](https://lsusports.net/news/2026/09/27/football-dominates-no-23-texas-aandm-cruises-to-35-6-victory) corroborates the receiver's five catches for 107 yards. CFBD provider search and stored player-game payloads independently distinguish IDs 5141697 and 5226917.

## Regression coverage and reproducibility

The sanitized fixture __tests__/fixtures/cream-bowl-period4-scoring.json captures the actual source weights and period-4 starter stat rows, with Winston's corrected provider row. It contains no database credentials, ownership identifiers, or league settings metadata. The application-scorer tests recompute every team from those rows, including the explicit two-point residual.

Tests cover: TE vs WR vs unknown position (including refusal of supplied TE-bonus counts for non-TEs), adapter-to-scorer preservation, exact zeros, source weights versus inferred presets and seeded defaults, explicit edit precedence, panel save/read round trip, return-TD separation and multiple-game aggregation, malformed/unknown return keys, and guarded identity refusals for mismatched names, positions, schools, existing links, duplicate source claims, and reverse ownership collisions.

Repair entry point: scripts/repair-winston-watkins-identity.ts. Required arguments: --snapshot=<owned Fantrax snapshot UUID> and --expected-db-host=<explicit database hostname>. Add --apply only after reviewing its dry-run output. It never writes scores, lineups, or source actuals.

Raw captures, before/after comparison evidence, and identity backup remain local under tmp/cream-bowl-scoring-2026-10-06 and tmp/winston-identity-before-*.json. Remaining full-readiness work includes athlete-level two-point evidence, historical/native presentation, and remaining eligibility checks.
