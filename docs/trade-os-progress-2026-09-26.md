# Trade OS rebuild status

## Completed and released

- Shared value-grade labels and proposal verdicts; league-grade values displayed beside market prices.
- Opponent roster counteroffers are re-evaluated as complete packages rather than inferred from shortlist prices.
- Linked roster identity, owned future picks, supported IDP and kicker pricing, and completed-week league context corrections.
- Active capacity excludes owned IR/taxi assignments. Picks consume no current player slots; warnings describe required cleanup rather than universal platform rejection.
- Stored, owned salary contracts validated across commitment years and recorded dead money; stable cap-growth origin and read-only future previews.
- Commissioner-hub card button wraps within tablet columns; production Chrome checks at 390px and 768px passed.

## This release

Proposal results expose a separate salary-cap affordability result, contract salary/expiry, and both teams' post-trade cap commitments and room each year. Unknown or ambiguous ownership withholds the cap result. Counteroffers must satisfy configured cap/floor rules when the league has salary-cap rules; unverified packages are excluded. Cap facts remain visible to free users alongside the value verdict and are included in Chimmy's structured proposal payload. This does not change shared asset value grades or invent a salary-to-market multiplier.

[Reality Sports Online's documentation](https://realitysportsonline.com/Content.aspx?articleID=how-it-works) demonstrates why current and future contract commitments matter. AllFantasy uses its own stored rules, not RSO guarantees or cut penalties.

## Remaining work

1. Integrate affordability with all proposal/email surfaces and revalidate atomically when contracts and players move on acceptance. A preview cannot guarantee settlement.
2. Complete missing NFL/IDP/college asset pricing with documented per-player inputs and provider coverage. Do not substitute identical placeholder values.
3. Compare actual pre/post starting lineups with eligible replacements. Calibrate game/playoff forecasts before displaying percentage claims.
4. Implement evidence-backed role, coaching, offensive/defensive scheme, and expanding-player-pool effects with timestamps and bounded weights.
5. Capture cap startup year during commissioner setup/import; clarify future floor enforcement and unsigned roster-completion requirements. Unsigned rookies and future acquisitions are not current funded commitments.
6. Broaden Chrome walkthroughs and test physical iOS Safari keyboard, safe areas, dialogs, and scrolling. Viewport checks and CI WebKit do not establish physical-device compatibility.

Trade previews and counteroffers remain unsent; no other manager is contacted by these checks.
