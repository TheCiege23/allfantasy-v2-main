# Big Brother standings

## Scope and sources

The league shell routes Big Brother leagues to a dedicated standings page before checking standard redraft standings. Other formats retain their existing routes.

The read-only member API is `/api/leagues/:leagueId/big-brother/standings`. It uses canonical league membership, selects public cycle fields, and sends private/no-store responses. It never reads eviction or finale ballots, writes results, starts cycles, or runs scoring.

- Identity: `Roster.id`, explicit `LeagueTeam.legacyRosterId`, then a unique platform/claimed-user match. Ambiguous matches use a roster label; no name/order matching or email exposure.
- Competition records: recorded HOH, veto and nomination fields, counted once per cycle.
- House status: current unsolved cycle, with veto-saved nominees removed from the block. Resolved cycles no longer confer current power badges.
- Finish: eviction order, latest eviction first. Active teams have no numbered finish. A winner is shown only from the published FinaleService audit result, and only if still an eligible finalist. Remaining finalists have unknown positions until the engine records them.
- Fantasy points: current-season `TeamWeekResult` rows with `status=final`. Includes scored-week coverage. Missing scores render a dash; genuine zero and negative scores are preserved. These totals are informational, not an eviction tiebreaker or finish ranking. The challenge engine retains its existing score sources and rules.
- Jury: enrolled, evicted roster IDs only.
- Setup: actual roster seats with awaiting-start status, no sample scores or placements.

Official format research: [CBS episode guide](https://www.cbs.com/shows/big_brother/episodes/27/) describes HOH, veto, eviction and jury-selected winner as distinct outcomes. The implementation follows this app's persisted rules and configurable final-two/final-three format.

## Verification

Focused rule/API/service/UI tests cover setup and empty leagues, current block after veto, resolved badges, eviction ordering, jury, final-two/final-three, published winner eligibility, unknown positions, real zero/negative/missing scores, season scoping, team identity, claim-only viewers, unauthorized access, retry, revoked access and league-switch cancellation.

Existing Big Brother engine regressions run alongside the new tests. Browser preview uses the actual component with synthetic fixtures, never production writes. Verify 390px phone containment, a constrained scroll panel, search/filter/sort, and desktop/light-mode presentation. Required CI gates precede merging; after deployment, confirm real Blah roster seats and setup state in production.
