# Zombie sport-calibration checkpoint — 2026-11-02

The owner selected **matching the approved 2025 NFL frequency** for the other six sports. This checkpoint establishes the historical comparison and data-quality gaps. It does not certify sport calibration, change production thresholds or record manager acceptance.

## Historical NFL comparison

A guarded production read-only audit of 2025/2026 found two imported 20-manager NFL leagues with four FLEX slots and one Superflex. Restricting that cohort to 2025 produced **360 distinct matchups over 18 periods**. Six had a margin of at least 60: **1.67%**. Mean margin was 20.67, median 17.29, and the 90th percentile 43.10. There were no ties.

This is a descriptive raw-total benchmark, not a measured bashing/mauling rate: winner roles and item inventories are absent, and imported totals may contain external adjustments. Weapon award rates cannot be inferred without verified base player points. The canonical creation default is also four FLEX plus one Superflex (five starters), matching this historical roster shape. The rules-document roster description is stale; this cohort still must not silently become a universal reference for other scoring recipes or manager counts.

The existing NBA 128/211 calibration comments target old NFL 30/50-margin frequencies (52%/29%). The approved NFL preset is now 60/60. Reusing the old NBA frequency target would not implement the owner's decision.

## What the stored data supports

| Sport | Stored historical matchup rows, 2025/2026 | Finding |
|---|---:|---|
| NFL | 97,735 | Different formats/seasons; the separately identified historical 2025 cohort above supplies a descriptive comparison only. |
| NBA | 95 | 90 scheduled/unknown 0–0 pairs; only five nonzero pairs. Imported roster differs from Zombie defaults. Finality and historical rules need verification. |
| NHL | 144 | 114 scheduled/unknown 0–0 pairs; 30 nonzero pairs. Goalie/roster shape differs. Finality and historical rules need verification. |
| MLB | 0 | No matchup sample in this audit. |
| NCAAF | 1,752 | A 12-manager cohort has 60 unknown 0–0 pairs; the other cohort has 140 managers and an unrecorded starter shape. Neither is a matched Zombie reference. |
| NCAAB | 0 | No matchup sample in this audit. |
| Soccer | 0 | No matchup sample in this audit. |

There are also 24 final native NFL and eight final native NHL matchups, all outside Zombie leagues. Final player-row and calendar counts establish availability, not provider completeness or gameplay acceptance. The analyzer currently qualifies **zero** samples for final threshold proposals because the required combined source, completion, base-score and historical-configuration evidence is absent. This does not mean all historical scores are wrong.

Most non-NFL sports still use legacy item mechanics: simultaneous threshold awards and achievement weapons. NFL 2025 uses exclusive score-band awards and separate base points/item modifiers. Frequency matching must review those mechanics too. For MLB/NHL/NCAAF/NCAAB/Soccer, documented knife thresholds also differ from the effective legacy-engine fallbacks; the report exposes both rather than silently rewriting live rules.

## Existing raw box scores can support the next replay

The deeper read-only check found these stored player-game rows. These are **raw data availability**, not a completed matched-roster replay or proof that every scheduled game/player is present.

| Sport | Stored player-game rows | Observed seasons/dates |
|---|---:|---|
| NFL | 58,028 | 2025 and 2026; some legacy source fields are null. |
| NBA | 4,763 | 2026, October 3–November 1; includes dates before the regular-season opener. |
| NHL | 11,511 | 2026, September 21–November 1; includes preseason dates. |
| MLB | 73,744 | 2026, March 25–October 28; postseason must be separated. |
| NCAAF | 80,453 | 2026, August 27–October 31; separate source families and confirm player/game coverage. |
| NCAAB | 110,658 | 110,640 from the 2025-start season plus 18 from 2026. |
| Soccer | 43,207 | 35,144 from the 2025-start season plus 8,063 from 2026; confirm competition membership. |

MLB, NCAAB and Soccer therefore do not require starting data collection from zero. The next replay can first use these stored box scores, resolving canonical player identity and positions, the league-specific scoring recipe, historical starts/rosters, and regular-season/gameweek membership. Backfill only demonstrated gaps through the normal bounded ingestion path. Simulated rosters can support sensitivity analysis, but must stay labeled as simulations and cannot become real-manager acceptance.
## Repeatable analysis

Run `scripts/audits/zombie-sport-calibration.ts` using the installed tsx CLI, explicit `ZOMBIE_CALIBRATION_SEASONS=2025,2026`, and either the approved loopback database or the known-production read-only guard `ALLOW_ZOMBIE_READONLY_PROD=1`. Use the explicitly scoped Railway project/environment/web service when reading production. No provider API is called. The runner uses a PostgreSQL READ ONLY transaction, a statement timeout and hard row bounds. It outputs aggregate counts/formats/distributions without league, team, manager or player identifiers. Raw rows and settings stay in process memory. Other NFL cohort details are omitted from the saved report while their aggregate counts remain.

The pure analyzer rejects unknown finality/provenance, incomplete lineups, incompatible profiles, missing base scores, correction holds and synthetic data. It isolates seasons, de-duplicates mirrored pairings, quarantines conflicting duplicates and keeps legitimate final zero scores. Score distributions preserve outliers and report mean/median/IQR/percentiles. Proposed thresholds match observed >= frequencies and disclose ties and achieved error. Weapon candidates use base scores, never item-boosted totals. They are proposals only and cannot update settings or acceptance.

The default screening minimums (60 decisive matchups, six periods, three leagues, one configuration) are conservative analysis settings, **not a new product acceptance rule or statistical guarantee**. Repeated team/period observations are dependent, so no binomial confidence interval or independent-sample significance claim is made. Historical raw-margin summaries are deliberately separate from qualified proposals.

Calendar checks must use the selected season, competition and scoring windows. Fixed All-Star-break week numbers in descriptive Zombie configuration are not authoritative. The NBA's published [2026–27 schedule](https://pr.nba.com/2026-27-nba-regular-season-schedule) and [official key dates](https://www.nba.com/news/key-dates) provide the season-specific reference; the platform's actual daily-sport date-window resolver remains the runtime authority. No calendar was changed here.

## Remaining work, in order

1. Build a provenance-complete, completed-period replay set for the selected Zombie roster/manager count and scoring preset. For imports, verify historical period finality, actual scoring/roster settings and player base points from the saved source first; use a bounded normal provider backfill only for demonstrated gaps. Scheduled 0–0 entries cannot count as played games.
2. Replay NFL 2025 with roles, item awards, serum use and corrections; establish role-conditioned combat and exact weapon-band frequencies. The 1.67% raw-margin rate is a comparison, not a substitute for that replay.
3. Construct comparable completed NBA/NHL/MLB/NCAAF/NCAAB/Soccer replay samples from the existing raw box scores where coverage permits; fill demonstrated gaps. Run per-configuration frequency matching, check sensitivity to rest/bye/break periods and manager count, and review legacy item-mechanics compatibility before accepting numbers. Preserve historical sealed snapshots.
4. Rehearse each accepted sport's real ingestion, lineup locks, correction/recovery, once-only settlement/reports and season-length/survival behavior. Controlled fixtures cannot establish provider completeness.
5. Run the consenting real-manager scoring week when leagues are ready, then complete physical-iPhone acceptance. The owner previously said leagues are not full; original drafts remain unstarted.

## Validation and release state

Sixteen focused analysis tests and 36 adjacent policy regressions pass, covering sample rejection, legitimate zeros, mirrored/conflicting pairs, season isolation, configuration separation, deterministic ties, the 60-point reference, missing base points and item-boost exclusion. Lint passed. A strict scoped TypeScript check passed for the analyzer, runner, sport configurations and tests. The generated JSON report is the actual anonymized production read-only result, not a fixture. No production gameplay rules, calendar settings, acceptance records or drafts were changed.
## Recorded replay follow-up

The recorded box-score replay has now run for all seven sports. See [the replay results](2026-11-02-recorded-box-score-replay.md) for actual counts, modeled-roster outcomes and demonstrated blockers. This checkpoint remains the earlier historical audit, not the replay result.
