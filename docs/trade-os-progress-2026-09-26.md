# Trade OS rebuild status

## Completed and released

- Shared value-grade labels and proposal verdicts; league-grade values displayed beside market prices.
- Opponent roster counteroffers are re-evaluated as complete packages rather than inferred from shortlist prices.
- Linked roster identity, owned future picks, supported IDP and kicker pricing, and completed-week league context corrections.
- Active capacity excludes owned IR/taxi assignments. Picks consume no current player slots; warnings describe required cleanup rather than universal platform rejection.
- Stored, owned salary contracts validated across commitment years and recorded dead money; stable cap-growth origin and read-only future previews.
- Commissioner-hub card button wraps within tablet columns; production Chrome checks at 390px and 768px passed.
- Proposal cap details show both teams' recorded commitments and contract expiry. Salary-cap counteroffers must pass affordability checks.
- Native contract settlement and reversal preserve ownership and terms, evaluate all participants' commitment years, and record contract evidence alongside rosters.

## Contract settlement release (PR #1345)

Native generic (`AfLeagueTrade`) settlement moves each owned, unexpired contract with its player, preserving salary, signing year, term and status. All participants in a multi-team trade are evaluated together against recorded current/future commitments, dead money, rollover and configured floors. Contract ownership, roster changes, refreshed ledgers and contract evidence share the processing transaction. Settlement and commissioner reversal use serializable transactions with a bounded 20-second limit. Ledger reads are batched across participants and commitment years; a conflict fails safely rather than applying a partial trade.

Execution snapshots record contract ownership and terms before and after settlement. A commissioner reversal refuses missing legacy salary evidence or subsequent contract changes, restores ownership with players, and recomputes legality under current rules. Cut contracts and their dead money stay with the original team. This applies to native roster IDs and stored contracts, not writes to imported host platforms or the separate redraft salary engine. Other contract mutation services still need a concurrency audit and unified transaction policy.

[Reality Sports Online's documentation](https://realitysportsonline.com/Content.aspx?articleID=how-it-works) demonstrates why current and future contract commitments matter. AllFantasy uses its own stored rules, not RSO guarantees or cut penalties.

## Contract ownership release

Cuts, extensions and franchise tags require the current contract owner or head commissioner. League membership alone grants no write permission. The server session supplies the actor identity; native roster ownership and explicitly claimed imported teams are resolved inside the same serializable transaction as the mutation. Conditional writes include the authorized roster, status and contract version, so a stale request cannot overwrite a contract after a trade moves it. Extensions and cut events roll back as a unit if their second write fails. Invalid extension numbers and backdated cuts are rejected before any write.

This closes these three mutation routes. Other acquisition, lifecycle and ledger writers still require the broader concurrency and cap-legality audit. Franchise-tag term renewal and rollover idempotency remain separate lifecycle work.

## Core matchup and lineup receipt accuracy

Partial current-period scores no longer claim wins or losses. Completion uses advanced saved league periods or completed season markers; past-season fallback applies only without same-season metadata. An active season can continue into January, and conflicting imports must agree before a result is claimed. Recaps exclude explicitly partial results and do not classify ties as losses; completed cards omit predictive win odds. The weekly cache version advances to retire older payloads without completion evidence. Custom negative scores remain visible and a completed 0–0 matchup is a tie rather than a schedule placeholder.

Lineup receipts show all incoming and outgoing players from the optimizer's complete legal lineup. Independently selected names are no longer presented as a direct swap, which could imply replacing a tight end with a linebacker. Older receipt payloads use a safe single-player description.

Sleeper documents [live scoring and later stat corrections](https://support.sleeper.com/en/articles/2441282-stat-corrections) and [weekly score adjustments](https://support.sleeper.com/en/articles/3410666-adjusting-weekly-lineups-scores). These changes distinguish partial scores from recorded outcomes; they do not promise immutable results.

## Remaining work

1. Integrate affordability with all proposal/email surfaces, add salary-surplus and keeper-cost valuation, and audit signing, lifecycle, ledger refresh and season rollover. Validate settlement against a dedicated PostgreSQL salary-league fixture; no production manager trade is used as a test.
2. Complete missing NFL/IDP/college asset pricing with documented per-player inputs and provider coverage. Do not substitute identical placeholder values.
3. Compare actual pre/post starting lineups with eligible replacements. Calibrate game/playoff forecasts before displaying percentage claims.
4. Implement evidence-backed role, coaching, offensive/defensive scheme, and expanding-player-pool effects with timestamps and bounded weights.
5. Capture cap startup year during commissioner setup/import; clarify future floor enforcement and unsigned roster-completion requirements. Unsigned rookies and future acquisitions are not current funded commitments.
6. Broaden Chrome walkthroughs and test physical iOS Safari keyboard, safe areas, dialogs, and scrolling. Viewport checks and CI WebKit do not establish physical-device compatibility.
7. Reconcile the empty unified proposal timeline with the separate imported archive (44 completed trades in the audited IDP league), and explain provider freshness independently of live-score refresh.

Trade previews and counteroffers remain unsent; no other manager is contacted by these checks.
