# Trade OS audit and implementation receipt — September 26, 2026

This is a partial implementation, not certification of a finished Trade OS. Changes are local and have not been deployed. Production Chrome observations below were made before these changes.

## Verified failures and fixes

| Finding | Evidence | Change |
| --- | --- | --- |
| IDP players have no picker values, although analysis prices them | Defense IDP For Life: Quinnen Williams and Ventrell Miller both showed missing prices in the roster. Analyzed swap showed 229 sent / 262 received, B/D | Roster endpoint now loads the existing league defender/kicker value model. Partner ranking consumes those same roster values. |
| Correct IDP prices were described as failed FantasyCalc matches | The same swap reported two API-record fallback warnings even though sources were `idp_league` | League-derived IDP/kicker prices no longer generate missing offensive-market warnings. |
| Pending email carries no proposal grade | Pending email renderer only listed names | Pending notifier now calls the shared league grader for the recipient; email displays its letter, totals, per-asset values, adjustments, or withheld reason. |
| Commentary misstates what determines the grade | Live analysis said composite-based market delta while its grade used league values | Commentary now describes league values; UI labels distinguish roster need from starting-lineup points. |
| Counter list starts with stars irrespective of the shortfall | A 33-point IDP swap listed Bijan Robinson and Ja'Marr Chase first | For an underpaid side, targets are sorted by distance to the deficit. Suggestions identify the candidate and residual; they require re-analysis because candidate market value is not yet its adjusted value. All available targets are considered before trimming. |
| Healthy players are shown as injury warnings | Both sample players carried `ACT` warnings | Active/healthy status is excluded from injury warnings. |
| Injured acquisitions are counted as filling holes | Incoming need slots were always marked available | Known unavailable incoming players do not fill a hole or receive a hole-filling premium. |
| Dashboard records include unfinished games | League home Power Board showed 3–0 while standings showed 2–0 during week 3 | League home bounds all-play history to weeks before the active week, using league week resolution. Completed seasons retain the final week. |
| Copy claims unsupported positions make a half-priced grade | Sample IDP deal had complete prices | Copy now explains league-derived values and the missing-price refusal. |

## What the research supports

[FantasyCalc's FAQ](https://fantasycalc.com/frequently-asked-questions) explains that package comparisons include the value of roster space and replacement players. **Implementation implication:** do not declare a 3-for-1 a win by summing three weekly projections; calculate the legal lineup after required drops and waiver replacement. Existing market prices can already incorporate package behavior, so do not add a second arbitrary consolidation premium.

[FantasyPros' tools](https://www.fantasypros.com/fantasy-football-tools/) include roster imports, trade analysis and bye-week views. Its [dynasty analysis](https://www.fantasypros.com/2026/02/12-dynasty-players-to-buy-or-sell-before-nfl-free-agency/) illustrates how opportunity changes move player and pick comparisons. **Implementation implication:** retain market value alongside roster-specific benefit, with explicit format, availability and role evidence. Dynasty and seasonal value must remain different horizons.

[Reality Sports Online](https://realitysportsonline.com/Content.aspx?articleID=how-it-works) models customizable scoring and contract settings, including cap acceleration. **Implementation implication:** salary is a contract cash-flow and legality problem; cap room alone cannot price a contract. Show salary by year, guarantees, remaining term, dead money, retained salary and the exact league rule applied.

[Guillotine Leagues](https://www.guillotineleagues.com/) describes weekly elimination. [Community discussions about trades after a chop](https://www.reddit.com/r/GuillotineLeagues/comments/1wcqc92/sleeper_choppedguillotine_league_what_happens_to/) show differing trade policies and settlement concerns. **Implementation implication:** read the actual league's trade eligibility and elimination rules. Model next-week survival, available FAAB and released rosters, rather than assume conventional playoffs or future rookie picks. Community posts are qualitative signals, not universal rules.

## Valuation architecture to finish

Use one versioned evaluation receipt for builder, inbox, Chimmy, notification, email and share/export. Include league/scoring snapshot, both roster snapshots, strategy, asset identity, source timestamps, source method, market baseline, adjustments, resulting value, model version and evaluation time. Emails should point to that receipt. A new evaluation is a new receipt; never silently rewrite an old proposal's evidence.

Keep these measures visibly separate:

1. **Market price:** what comparable assets trade for under matching format/settings.
2. **League-adjusted value:** scoring and scarcity/replacement adjustments with bounded, explained effects.
3. **Team benefit:** change in the legal lineup, cap flexibility, keeper options and future championship window.
4. **Observed result:** actual production after completion. This cannot retrospectively become the proposal grade.

Never invent differences between players just to make every number unique. Distinct identities must have individual evidence, but two players may legitimately have equal prices. Missing evidence should trigger a named gap, or a clearly labeled estimate with uncertainty; it must not become a fabricated confident price.

| Format/asset | Required calculation | Current completion gap |
| --- | --- | --- |
| QB/RB/WR/TE | Matching redraft/dynasty, QB format, scoring, roster/replacement pool | Existing market model is connected. Need calibration of custom-scoring effects and complete receipt parity. |
| LB/DB/DL/CB/DE/DT | League-scored individual projections and value over eligible replacement; respect actual slot eligibility | Existing defender model is connected to analysis and now the picker. Coverage and stale projection auditing remain necessary. |
| Team DEF | Rescore defensive components, rank against remaining defenses and eligible replacement | Universal league-calibrated team-defense pricing is not implemented by this change. |
| College QB/RB/WR/TE | Stable college identity, league-scored projection, eligibility horizon, NFL transition distribution where applicable | Existing non-NFL record fallback is not a validated C2C/devy market model. Do not call it complete coverage. |
| Future picks | Year, actual owner, projected slot distribution, rookie class and uncertainty | Existing live pick pricing remains; picker/analysis price and vintage parity still need consolidation. |
| Keeper | Marginal retained-production value minus retention cost; best legal keeper set before/after | Keeper costs/limits and selection optimization must be connected to the shared grade. |
| Salary cap | Multi-year surplus versus replacement; retained salary/dead cap/roster legality | Contract and cap-validator outputs must be wired into shared evaluation. |
| Guillotine/survivor guillotine | Paired survival simulation with weekly released player pools, replacement quality and FAAB | Existing specialty policy/notes do not make the shared value grade a survival model. |
| Big Brother | Phase, nominations, immunity, eviction/scoring rules and settlement eligibility | A generic market letter is insufficient; policy and paired outcome simulation remain to be connected. |

### Context and schemes

Use measured usage (snaps, routes, targets, carries, red-zone work, pass rate and personnel share) to adjust the underlying player projection. For defense, use player alignment, snap share, tackle opportunity, blitz/pressure usage and coverage responsibilities. Formation names alone do not imply fantasy production: Cover 2 is not automatically a bonus to every DB, nor does 12 personnel automatically benefit both TEs.

The existing sources must be checked for these fields, their licensing, freshness and team/player identity before adding a scheme effect. Apply a small calibrated residual only when the baseline projection does not already incorporate the usage. Explain data vintage and sample size. Do not double count a role change through both market trend and projection adjustments.

### Counter generation

The implemented nearest-shortfall candidates are a starting point. The completed version should enumerate legal additions/swaps from the counterparty's actual roster, reject duplicates/untradeable assets, evaluate both post-trade teams through the shared engine, and rank by mutual benefit, closeness, minimum changes and demonstrated negotiation patterns. Return the exact proposal, each asset's adjusted value, both grades and the remaining gap. Never imply a manager will accept based on a behavioral score alone.

### Outcome language

“You are 3–0” does not support a numerical acquisition win probability. Report paired before/after simulations with the same schedule, scoring, injury assumptions, seed and sample count: e.g. “playoff probability changes from 62% to 68% (+6 percentage points).” Show uncertainty. In elimination leagues show survival probability. Without that model, give an explicitly qualitative recommendation.

Bye collisions are manageable costs, not automatic rejection. Compare the legal lineup after the deal against the lineup before it for each affected week, include free agents and IR/taxi eligibility, and identify whether the trade creates a new uncovered starting slot.

## Remaining upgrade priorities

| Priority | Work | Impact | Effort |
| --- | --- | --- | --- |
| P0 | Persist evaluation receipts and use them for every outbound grade | Trust and reproducibility across all surfaces | Medium |
| P0 | Complete DEF/college coverage and expose source/estimate/age per asset | Removes silent asset exclusions | Large |
| P0 | Contract, keeper and specialty rules integrated with shared evaluation | Prevents misleading format grades | Large |
| P1 | Paired weekly/season outcome simulations and uncertainty | Meaningful contender/rebuilder/survival recommendations | Large |
| P1 | Counter search with ownership/legality and both-team validation | Actionable negotiation | Medium–large |
| P1 | Consolidate picker/analysis picks and valuation timestamps | Arithmetic consistency | Medium |
| P1 | Move inbox/history behind concise controls so the builder is reachable immediately | Faster desktop/mobile trade flow | Medium |
| P1 | Exact 390/430px Safari and 768/1024px tablet regression checks | iOS usability | Medium |
| P2 | Calibrated scheme/usage residuals and observed-trade backtesting | Differentiation without unsupported precision | Large |

## Validation and limits

Chrome click-through covered `/core`, an IDP league overview, its Trade Center, opponent selection, and a real unsent defender-swap analysis. No trade was sent to another manager. Production findings include source/copy inconsistencies and live-week record inflation. Responsive screenshot captured the narrow layout, but the browser's requested 390px override produced a 520px inner width. Later screenshot and navigation commands timed out, preventing tablet certification.

Local development compiled `/core`, but authenticated local verification failed with a JWT decryption error, and provider calls encountered restricted network access. These changes have not been verified against authenticated local league data or on an actual iOS device. Unit/contract tests verify the new grade renderer, counter selection, picker wiring and live-week exclusion; see the final response for completed test totals. Full repository typecheck results are recorded separately when available.

Final verification: **176 tests passed across 13 targeted suites**. `git diff --check` passed. The full repository typecheck reported **112 errors**; none named the changed trade/dashboard files. Output is at `.af-tc/trade-upgrade-typecheck.txt`. Unrelated working-tree changes were preserved.

## Broader rebuild continuation

Implemented the next shared-evaluator improvements:

- Counteroffer search considers actual roster assets on either side, shortlists four candidates, re-prices each complete package with the shared league grader, and keeps at most three proposals that improve both the absolute value gap and percentage imbalance. Each reports the resulting letters, asset league value, remaining gap, and whether it falls within the existing even-value band. This is a bounded single-addition search, not exhaustive package optimization or both-manager utility simulation.
- Trade Center renders these counters with an Add to proposal action. The action retains the real provider player ID and clears the obsolete analysis. Counteroffer details use the existing trade-depth access policy.
- Roster context now resolves the viewer's claimed team to the provider account, refuses to substitute a random counterparty, preserves provider player IDs separately from engine IDs, and includes complete deep rosters beyond the old 45-player cutoff.
- Negotiation pick inventory now comes from the existing native/imported future-pick ownership loaders. Drafted-player JSON is no longer treated as future draft capital. Current chart prices are preferred over the historical curve when available.
- Captured rules disabling trades or pick trading now withhold a proposal grade centrally. Unknown settings are not invented. This does not yet certify deadlines, roster size, contract/cap legality, or specialty lifecycle eligibility.
- Shared lineup eligibility recognizes CB, safety, DE, DT, EDGE and their DB/DL/IDP flex eligibility.
- Production comparisons no longer claim to predict wins. Missing projections produce an unavailable production lean; league-value lean follows the grade's own bands rather than a second dynasty threshold.

Chrome live inspection also covered the keeper league overview. It confirmed the same live-week Power Board discrepancy documented above. A tablet screenshot timed out; the temporary viewport was reset and the restored page width inspected. This live site inspection does not validate the local implementation, which is not deployed. Authenticated local and actual iOS verification remain outstanding.

Continuation verification: **122 tests passed in 12 suites**, covering counter search, the add-to-proposal interaction, roster identity and deep rosters, future-pick ownership, eligibility, defensive lineup impact and access filtering. `git diff --check` passed. The repository typecheck still reports **112 errors**, with none naming the files changed in this continuation; output is `.af-tc/trade-rebuild-typecheck.txt`.

The full requested rebuild remains incomplete: keeper/contract terms still need to enter shared proposal valuation, specialty released-player pools need to update replacement values, DEF/college coverage needs calibration, evaluation receipts need cross-surface persistence, paired outcome probabilities need real simulation inputs, and scheme effects need measured usage data. The existing salary validator also copies current legality into future-year legality; it must be corrected before any multi-year-cap certification. A keeper-contract surplus alone must not replace the player's current-season contribution.

Research rechecked against the [FantasyCalc FAQ](https://fantasycalc.com/frequently-asked-questions), [Guillotine Leagues rules description](https://www.guillotineleagues.com/), and [Reality Sports Online contract rules](https://realitysportsonline.com/Content.aspx?articleID=how-it-works). These support accounting for roster replacement, released rosters and contract obligations; they do not establish calibrated value multipliers or acquisition win probabilities.
