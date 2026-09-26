# Trade OS: roster capacity and contract validation

## Confirmed defects and corrections

The live Defense IDP For Life sample (C.J. Stroud for Chuba Hubbard and Darren Waller) warned of seven drops because it compared all 33 owned players with 27 active slots. Reserve and taxi assignments must be excluded from active occupancy. Only an outgoing active player frees an active spot; incoming players need active space until an eligible reserve assignment is made. Future draft picks do not consume current roster spots. Existing overflow is disclosed separately from the proposed net addition.

The salary-cap validation endpoint accepted client-provided salaries, wrote ledger rows during evaluation, and copied current legality into future legality. The corrected validator resolves each asset against its owned, unexpired stored contract, rejects duplicates and foreign rosters, reads cap state without writes, and checks committed years through contract expiry and the last recorded dead-money year. Responses include each year's cap ceiling, post-trade cap hit, and legality for both teams.

## Research basis

[Reality Sports Online's format documentation](https://realitysportsonline.com/Content.aspx?articleID=how-it-works) treats salary commitments in the current and future years as constraints on available cap room. Its documented guarantees and cut penalties demonstrate why current cap space alone cannot establish future affordability. AllFantasy uses its own configured contract and dead-money rules; RSO's individual percentages and acceleration rules are not imported.

[Sleeper's roster-limit documentation](https://support.sleeper.com/en/articles/3956140-can-a-team-go-over-the-roster-limit) permits trades over the roster limit and restricts subsequent roster operations until capacity is restored. [Its positional-limit documentation](https://support.sleeper.com/en/articles/5379935-how-do-i-set-positional-limits) excludes IR and taxi players from position limits. Capacity warnings must therefore describe the required roster cleanup, without universally claiming the imported platform will reject the trade.

## Next implementation priorities

1. **Connect contract diagnostics to the shared proposal grader and counteroffer search.** Show salary, expiry, each team's post-trade cap room, and the binding year. Withhold a final legality conclusion when required contracts or rules are missing. A fair player-value package may still be unaffordable.
2. **Persist a stable cap-growth starting year.** The existing cap calculator anchors growth to the current calendar year. Imported and long-running leagues need an explicit, durable starting season shared by current ledgers and future projections.
3. **Separate projected commitments from roster-completion requirements.** Future floors need a documented league policy for enforcement timing; unsigned rookies, extensions, and future acquisitions must never be presented as already funded. Add commissioner controls and explanatory copy before changing that policy.
4. **Show active, IR, and taxi counts in the proposal UI.** Identify the active-space shortfall and offer eligible actions. Verify roster assignment rules before recommending a reserve move; never automatically assume an incoming player can enter IR or taxi.
5. **Verify responsive trade cards and dialogs on actual iOS Safari.** Chrome viewport checks do not establish iOS keyboard, safe-area, or scroll behavior. Keep per-asset values and the required roster/cap actions visible alongside the grade on small screens.

## Scope limits

The contract endpoint is a validation foundation. This batch does not connect salary affordability to every Trade OS grade or trade acceptance path, move contracts, alter cap-growth policy, predict future unsigned acquisitions, or claim a calibrated change in win probability. Settlement must revalidate within its transaction; a proposal preview is not an atomic acceptance guarantee.
