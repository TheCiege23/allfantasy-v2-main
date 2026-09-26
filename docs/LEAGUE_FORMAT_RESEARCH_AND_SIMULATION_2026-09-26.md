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
