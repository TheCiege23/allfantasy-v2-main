# Recorded Zombie box-score replay — 2026-11-02

An actual, guarded production READ ONLY run processed **364,791 stored rows** and re-scored **326,784 regular-season stat lines** across all seven sports. Observation completed at `2026-11-02T22:25:12.151Z`. This is a recorded scoring replay plus explicitly modeled rosters, not real-manager gameplay acceptance. No production rules, calendars, drafts or acceptance records were changed.

## Coverage and primary 20-manager model

Each model ranks players using the first two observed completed periods, then replays later periods. The table uses tie-break seed 1; the JSON also preserves seeds 7 and 23 and separate four-manager comparisons. Seeds are dependent sensitivity scenarios, not independent leagues.

| Sport / start year | Stored rows | Re-scored lines | Observed completed periods | Later periods / modeled matchups | Result |
|---|---:|---:|---:|---:|---|
| NFL 2025 | 40,473 | 16,902 | 18 | 16 / 160 | Roster model replayed; diagnostic only |
| NBA 2026 | 4,763 | 2,733 | 1 | 0 / 0 | Insufficient verified periods |
| NHL 2026 | 11,511 | 9,822 | 4 | 2 / 20 | Roster model replayed; diagnostic only |
| MLB 2026 | 73,744 | 72,384 | 27 | 25 / 250 | Roster model replayed; diagnostic only |
| NCAAF 2026 | 80,453 | 78,303 | 9 | 7 / 70 | Roster model replayed; diagnostic only |
| NCAAB 2025 | 110,640 | 103,433 | 18 | 16 / 160 | Roster model replayed; diagnostic only |
| SOCCER 2025 | 35,144 | 35,144 | 0 | 0 / 0 | Insufficient verified periods |
| SOCCER 2026 | 8,063 | 8,063 | 8 | 6 / 60 | Roster model replayed; diagnostic only |

A re-scored line can fall outside a verified completed fantasy period; it remains a scoring-path diagnostic and cannot enter that period model. Ties are included in matchup counts and excluded from decisive-margin frequencies. `availableSeatRate` counts recorded appearances per lineup seat/day; normal rest days contribute empty seats and do not prove feed incompleteness. Missing boxes also cannot be assumed to be genuine DNPs.

## Findings and concrete blockers

- **NFL:** canonical creation is four FLEX plus one Superflex with three bench slots. It matches the five-starter historical cohort, correcting the earlier audit note that had used a stale rules-document roster description. At 60 points, the seed-1 raw-margin crossing rate is 1.89%, compared with 1.67% in the descriptive historical cohort. This is not a role-conditioned combat frequency or acceptance of all NFL data.
- **NBA:** only one verified completed period is available in this season. It cannot supply the two training periods plus later evaluation periods. Preseason rows were excluded; no zero weeks were fabricated.
- **NHL:** four completed observed periods allow only two later evaluation periods. That is too little to accept a frequency calibration. NHL scoring retains the live untouched-profile gated-key behavior.
- **MLB:** exact cached provider game IDs recovered season labels for 67,547 older rows, allowing the 27-period replay instead of silently dropping almost the entire season. Postseason remains excluded. Batting/pitching groups remain separate; baseball 5.2 innings means 17 outs.
- **NCAAF:** 41,185 otherwise re-scored lines have unresolved canonical player identity and were excluded from modeled rosters. The report also exposes missing positions and unsupported scoring fields. Coverage, division membership, identity bridging and actual eligible rosters need verification before accepting a threshold.
- **NCAAB.** The original granular default left 62 starter seats unfilled in the 20-manager model. The corrected default uses two guards, two forwards, one center and three bench spots. Guard slots accept G/PG/SG and forward slots accept F/SF/PF. The same recorded input now fills both roster sizes. Each seed replays 160 matchups at 20 managers and 32 at four managers across 16 evaluation periods. The new default applies to newly created leagues.
- **Soccer:** 35,144 archived-season lines were re-scored, but the 2025 three-competition gameweek calendar could not be verified, so none were assigned to invented fantasy weeks. The separate 2026 season has eight observed completed periods and supports six later model periods. The replay now maps Goalkeeper/GK to the canonical GKP token. That fixes this replay adapter, and does not establish that every live Soccer UI has correct aliases.
- **Cross-sport scoring gaps:** 23,571 NFL rows and 2,150 NCAAF rows have no mapped scoring fields under the live normalizers and were not given invented points. The JSON preserves all exclusions, unobserved scoring keys, schedule coverage and position-change diagnostics. An unobserved category may be rare, unsupported or outside this roster; it is not automatically a scoring bug.

## Calibration interpretation

The owner selected matching the 2025 NFL frequency. The current comparator is six raw margins >=60 among 360 imported historical matchups (1.67%). Imported totals lack verified roles, item inventories and base-score separation, so it cannot replace a role/item-state combat replay.

The JSON includes source-default margin crossing rates and exploratory thresholds for models with at least six evaluation periods. These are descriptive candidates only. They are sensitive to scoring recipe, canonical roster, manager count, training selection, identity coverage, rest periods and pairing assumptions. They do not update product settings. No sport is marked `acceptedCalibration:true`.

NFL-sized +/-10 serum and +/-35 bomb shocks are counterfactual flip sensitivities only. They are not observed item use, exact weapon-band awards or approved non-NFL item mechanics. Historical role/item/correction ledgers and legacy award semantics still need a separate complete gameplay replay.

## Method and safety

- Reuses the live NFL, CFBD and daily-sport stat normalizers, resolved AF-default scoring categories and unchanged authoritative category math. Football uses half PPR. Cached fantasy-point totals are ignored. This does not validate every custom commissioner scoring recipe.
- Uses canonical Zombie creation rosters and their explicit flex eligibility. Does not replace them with the different descriptive rules-document roster shapes. College generic G/F is not arbitrarily promoted to PG/SG/SF/PF.
- Uses verified stored football week/date bounds, the production daily-sport resolver, and a replay-only NCAA-published 2025-26 opener. The [NCAA published first-contest calendar](https://web3.ncaa.org/lsdbi/reports/getReport/90008) supplies November 3, 2025. No production calendar was modified. A Soccer calendar must cover EPL, La Liga and Serie A; an EPL-only schedule is insufficient.
- Exact game-ID joins can restore season labels from cached schedules; dates alone do not classify postseason. Current-day/preseason/postseason/unknown-type lines are excluded. Completed calendar periods with no recorded rows are reported rather than turned into 0–0 games.
- Canonical identities are bridged only through namespaced exact provider IDs; ambiguous/unresolved identities are excluded from roster modeling. Conflicting canonical player/game duplicates abort; identical duplicates are counted once. Positions are fixed from the earliest recorded eligible line, with later changes diagnosed and scores retained. Fallback identity positions can still reflect current metadata.
- Snake drafts and daily/weekly lineups exist only in memory. Rankings use earlier periods; no future points select a player. Recorded appearances are known retrospectively, so these are diagnostic models rather than demonstrated manager decisions. The same opposing modeled pairs are reused each period, not a verified real schedule.
- All database transactions use SET TRANSACTION READ ONLY, statement timeouts, hard row bounds and explicit known-production identity checks. No provider API, database mutation, production draft, notification or acceptance write is performed. Raw identifiers never enter the saved aggregate report; input hashes bind the replay to its recorded inputs.

## Validation and release

The focused replay tests cover hand-calculated scoring in every sport, baseball innings, Soccer penalty-goal non-duplication, NHL gated fields, season exclusions, conflicting duplicates, missing calendars/periods, chronological position changes, canonical goalkeeper aliases, unresolved identity exclusion, college-position shortfalls and selection without future points. Adjacent scoring and calibration-analysis regressions were also run; see the PR validation for final totals. Scoped TypeScript and ESLint passed. Shared category math was extracted unchanged and remains re-exported from the live scoring engine.

PR #3189 contains the roster correction and replay report. The rerun matched the previous input hashes and scoring weights for every sport. The other sports reproduced their previous model results. Forty-eight local tests passed across roster creation, lineup validation, saved templates and replay coverage.

## What remains, in order

1. Complete source coverage and identity/position bridges, verify the archived three-league Soccer calendar, and obtain more completed NBA/NHL periods. Use normal bounded ingestion only for demonstrated missing data. Verify each selected competition, season and custom scoring/roster cohort.
2. Replay actual 2025 roles, combat, weapon bands, serum/bomb use and correction ledgers; compare comparable sport/roster cohorts and review legacy non-NFL award semantics. Approve thresholds only after this evidence exists.
3. Rehearse each sport through actual ingestion, lineup locks, correction/recovery, once-only settlements/reports and full-season/survival behavior. Then complete the consenting real-manager scoring week and physical-iPhone acceptance when leagues are full. Existing drafts remain unstarted.
