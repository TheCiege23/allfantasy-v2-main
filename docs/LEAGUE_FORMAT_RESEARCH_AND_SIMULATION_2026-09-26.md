# Five-format lifecycle research and four-team simulation — 2026-09-26

## Format contracts

These are distinct choices, not five interchangeable labels. Local league settings control scoring, roster slots, commissioner authority, deadlines, waiver policy, timezone, regular-season length and postseason structure.

| Format | Creation and draft | Season and renewal |
| --- | --- | --- |
| Redraft | Choose owners, roster size, scoring, schedule and snake/linear/auction rules; all unrostered players enter the full draft. Snake reverses each round; optional 3RR changes round three. | Managers set legal starting lineups and use configured waivers/trades. Head-to-head and optional median records determine postseason qualification. Crown a champion, archive the season and start the next draft with empty active rosters. |
| Dynasty | A full startup draft establishes deep permanent rosters. Configure IR/taxi, future-pick ownership and later rookie/supplemental drafts separately from startup. | Same weekly scoring/postseason machinery, with year-round ownership. Retain players at renewal; apply traded future picks and draft eligible rookies or configured supplemental free agents. Do not reset the whole roster. |
| Keeper | Start with a normal full draft; define keeper maximum, eligibility, deadline and any round cost/escalation. Before later drafts, lock keepers into their charged slots and exclude them from the available pool. | Run the weekly season, then select permitted keepers. Return all other players to the pool; prevent cost collisions and changes after locking. |
| Best ball | Decide whether this is automatic-lineup scoring in a managed league or a draft-and-hold contest with locked rosters. Draft sufficient positional depth; configure championship/cumulative-points rules explicitly. | Select the highest-scoring **legal** lineup from actual weekly results. A player can occupy one slot only; bench depth matters, missing statistics cannot become fabricated zero scores. Underdog draft-and-hold has no in-season waivers, trades or substitutions. |
| Guillotine | Choose starting team count, start/end periods, chop frequency, correction window, tiebreak order, FAAB and endgame. Full startup draft; round direction is a draft setting, not inherent to elimination. | Chop the lowest weekly scorer and release its roster for survivors to bid on. Standard, double and two-week slow chops differ. Last-man-standing ends with one survivor; final-four cumulative scoring stops weekly chops and sums the configured final periods. |

Primary sources, checked 2026-09-26:

- [Sleeper league types and formats, updated April 22, 2026](https://support.sleeper.com/en/articles/3537396-league-types-formats)
- [Sleeper dynasty and year-round ownership](https://support.sleeper.com/en/articles/1960098-introduction-to-dynasty-leagues)
- [Sleeper startup, supplemental, auction, snake and 3RR drafts](https://support.sleeper.com/en/articles/1876072-what-draft-types-are-supported)
- [Underdog automatic weekly best-ball lineups](https://www.underdogsports.com/games/drafts)
- [Underdog draft-and-hold roster restrictions](https://help.underdogsports.com/en/articles/10716487-best-ball-sit-n-go) (search excerpt accessible; page fetch returned 403)
- [Fantasy Life official guillotine chop and playoff formats, updated August 30, 2026](https://mbfantasylife.zendesk.com/hc/en-us/articles/41319214266515-Traditional-Guillotine-Leagues)

Descriptions above are implementation requirements inferred from these format contracts; platform-specific defaults are not universal fantasy rules.

## Verification boundaries

The four-team script runs only against the explicitly allowlisted test database. It submits the complete redraft board using real pick services, verifies automatic roster finalization, scores 15 regular weeks with a median game, runs a two-round postseason, checks championship idempotency and creates the following season's draft. Its simulation calendar and synthetic player statistics are explicit fixtures. Playoff stat sealing is injected; actual roster scoring, bracket advancement and championship persistence use real services and the test database.

`validateCreatePayload` is checked independently for all five four-team choices. Rejected specialty creation is reported, not bypassed. Best-ball and guillotine comparisons use the production pure lineup optimizer and tiebreak resolver, not their complete persisted lifecycle. Dynasty and keeper next-season carryover already have eight-team real-service fixture verification in `smoke-league-finalization-testdb.ts`; that does not prove four-team creation.

The machine-readable run result is `artifacts/four-team-season-report.json`; logs are `artifacts/four-team-season-run.log`. Synthetic fixtures are deleted and remaining tracked rows checked. No synthetic production writes are involved.

## Newly identified defect

`releaseChoppedRosters` cleared `playerData.players` but retained starters and other lineup sections. A chopped team could therefore retain a displayed lineup referencing released players. The fix empties flat and nested lineup lists while preserving unrelated roster metadata. The regression now checks starters, bench, IR, taxi and devy references rather than expecting stale starters.

## What remains before broad acceptance

- Resolve the supported small private-league sizes deliberately: four-team dynasty, keeper and best-ball are currently rejected by the catalog; guillotine is checked by its sport-specific range.
- Verify authenticated browser journeys for every format, including editing settings after creation, full live drafts, commissioner overrides, keeper locking and rookie/future-pick ownership.
- Verify actual active player-pool image, logo, statistics and ADP coverage by sport and identity, including broken asset URLs; synthetic season tests do not cover this.
- Exercise the complete persisted best-ball and guillotine lifecycle, including FAAB claims, elimination retries, correction windows, endgame choices and season renewal.
- Exercise provider refresh, score correction, calendar jobs, playoff ties and multi-week rounds with controlled fixtures. A simulated score seal is not proof of provider/cron operation.
- Verify auction budgets/nomination completion and reconnect/pause/autopick behavior separately from a snake draft.

## Four-team offseason comparison

The additional offline script `scripts/simulate-four-team-offseason.ts` passed using the production keeper validation, keeper-lock mapping and pick-ownership resolver. It modeled 60 startup players: keeper protected eight players (two per team), reserved eight unique round-two/round-three snake slots and returned 52 players to the pool. Dynasty retained all 60 players, added 12 rookie selections and applied the traded first-round pick, producing roster sizes 17/19/18/18. These are pure rule models; they do not bypass native creation restrictions or certify specialty database renewal.

## Completed run results

The final guarded run exited 0. Redraft accepted four teams; dynasty, keeper, best-ball and guillotine rejected four-team creation. The redraft simulation submitted all 60 picks over 15 snake rounds, finalized four rosters automatically, scored 30 regular matchups over 15 weeks, and maintained 30 head-to-head/median decisions per team. Final regular records were Team 1 17-13 (156 PF), Team 2 16-14 (152 PF), Team 3 13-17 (148 PF), Team 4 14-16 (144 PF). The two real playoff rounds crowned Team 3; repeated finalization left exactly one championship record. Next-season draft creation passed. Tracked synthetic leagues, users and weekly scores all returned to zero.

The pure best-ball comparison covered 17 weeks and produced totals 512/533/554/560 (Team 4 wins). Its deliberately small QB/superflex roster checks eligible optimal assignment without duplicate player use; it is not a full default best-ball roster or persisted contest. The guillotine comparison chopped Teams 1, 2 and 3 over three periods, leaving Team 4. This is a last-man-standing rules model, not a 17-week guillotine or waiver-claim simulation.

Guillotine release regression: 11/11 tests passed; secret scan passed. Full specialty production readiness is still unproven for the limitations above.

## Follow-up: small specialty creation and persisted verification

The creation gap is repaired in the follow-up: dynasty, keeper and best-ball catalog options now include four and six teams; NFL guillotine starts at four. Defaults remain twelve for the first three and seventeen for NFL guillotine. The separate NFL guillotine validator also accepts four. Best-ball unspecified playoff defaults fit the team count, while explicitly oversized playoff selections still fail validation. Changing the wizard's team count also fits dynasty playoff teams/byes and best-ball playoffs.

The new real test-database carryover script passed with four teams: redraft finalized 60 players; dynasty finalized and retained 40, opened a rookies-only draft and applied one traded future pick; keeper finalized 64 and placed its locked keeper in the following draft. Weekly scoring, median standings and repeated-finalization/renewal guards passed for each. These use completed draft fixtures and seeded offseason choices rather than full browser offseason journeys.

Persisted best-ball roster scoring passed 17 weeks for all four teams: 68 complete legal lineups and 68 selections of the stronger bench QB. It used full twelve-player rosters produced by canonical creation/draft finalization. This does not certify best-ball contest advancement, championship persistence, or cumulative standings.

Persisted guillotine verification completed three elimination periods, marked season rosters eliminated, updated survival/audit state, released flat and nested player references, and resolved a single champion. The baseline simulation exposed that the audit's already-recorded check occurred AFTER the chop: repeating a period eliminated another survivor. The fix checks completed periods before evaluation or writes, protects the last survivor, and serializes the engine with a distributed lock. Two concurrent period-one calls committed exactly one chop; repeating the final period preserved the champion. Native automation has a separate outer lock; the engine lock also protects other entry points. Partial failures between state changes and audit persistence still require recovery testing; the engine's writes are not one all-or-nothing transaction.

Regression verification: 63/63 checks passed across creation choices, small-format validation, guillotine release/retry, chop audit, native weekly jobs, specialty handlers and lock contention. No production fixture writes. Test fixture cleanup also explicitly removes non-cascading guillotine event/state rows; three orphaned fixture groups from earlier diagnostic runs were cleaned using their exact synthetic player pattern and verified absent parent leagues.

Remaining acceptance work now centers on full authenticated journeys, active player asset/stat/ADP coverage, provider/cron integration, best-ball postseason and renewal, guillotine FAAB claims/correction recovery/endgame variants, and auction/reconnect/autopick behavior. Earlier four-team rejection results above describe the pre-fix baseline.

## Authorized read-only production cache audit

`audit-draft-cache-coverage-readonly.cjs` enforces `BEGIN READ ONLY`, a 20-second SQL timeout, and rollback. It invokes no player resolver, provider or cache-writing path. Observed 2026-09-27 00:09 UTC (September 26 local): among the top 300 stored NFL ADP candidate records, eight have a headshot/logo directly in `sports_players`, 289 have a non-empty statistics object, and stored `SportsPlayer` identities offer image candidates for 280. Restricting that cohort to canonical QB/RB/WR/TE positions yields 246 of 249 image candidates. Matching uses stored ID or exact name/position; it is a coverage candidate check, not authoritative identity resolution or URL validation.

Other sports have no positive ADP values or stored headshot/logo values in this particular `SportsPlayerRecord` cache layer. Other stores and enrichment paths may supplement it; this does not establish that their resolved draft pools have no images or ADP. Non-empty statistics JSON does not prove current-season or player-correct stats. The cohort includes multiple positions and cache records, not an exact league-eligible pool or a deduplicated list of active players. Live resolved-pool rendering/URL/identity checks remain acceptance work.

Final safety refinement: even when a chop's audit failed after roster-state writes, retry stops before evaluating another survivor and reports `audit recovery required`. State checks are bounded by the current season's creation time when a season shell exists. The distributed lock is released on that refusal. The final real test-DB run again verified concurrent exactly-once elimination, three periods to one champion, safe final-period retry, and zero tracked guillotine event/state, league, user and score rows. Regression checks now pass 64/64. The TypeScript ratchet completed with 143 errors against the repository's existing baseline of 143, with no regressions; this is not a zero-error repository-wide typecheck.

The preceding stale-lineup release (PR #1357, commit a3455a6b5dbc3a8fea8f3d81801299bb15499337) reached Railway SUCCESS. The small-specialty follow-up is PR #1360 and remains subject to protected checks and a separate production deployment verification.

### September 27 follow-up: multi-team guillotine chops

The automatic elimination engine previously sent only the lowest-score tie group to its resolver. A configured two-team chop therefore eliminated only one team when scores differed; the resolver also discarded higher groups needed to fill the second elimination slot. Four new regression cases failed against that implementation.

Selection now includes the complete active scoring field and applies each configured tiebreaker only where a tied group crosses the elimination cutoff. Complete tied groups below the cutoff remain selected. Commissioner override IDs must be valid and distinct; a partial commissioner tiebreak fills the remaining slots. The engine caps the chop count at active teams minus one to retain the last-standing champion. Existing draft-slot ordering is preserved.

This matches the official [Double Chop description](https://mbfantasylife.zendesk.com/hc/en-us/articles/41319214266515-Traditional-Guillotine-Leagues): the two lowest-scoring teams are eliminated. Final Four cumulative playoffs are a separate format and remain outside this verification.

Validation: 259 tests across 17 guillotine suites passed. The guarded known-test-database simulation (`scripts/smoke-four-team-specialty-testdb.ts --guillotine-only --double-chop`) created four teams, finalized fixture draft picks, persisted period scores, eliminated two teams then one, released every chopped roster, resolved a champion, and verified concurrent first-period requests and a completed-period retry. All fixture leagues, users, scores, roster states and event logs were removed and cleanup counts were zero. This uses synthetic scores and completed-pick fixtures; it does not certify live provider refresh, FAAB claims, browser draft interaction, slow-chop windows or Final Four endgames.
