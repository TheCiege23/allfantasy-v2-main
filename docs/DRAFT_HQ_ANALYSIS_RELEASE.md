# Draft HQ history and analysis — October 4, 2026

## Implemented scope

- Commissioners can review unresolved historical Sleeper sources in the selected league and season, preview at most 50 exact selection matches, and explicitly attach a verified source with a private reason and before/after audit. Duplicate local identities, ambiguous provider selections, stale previews and concurrent changes are preserved. Raw player, round and selection-order facts are never rewritten.
- Source-backed ADP and market-value references have separate provenance, format and identity coverage. Daily reference captures extend the existing authenticated ADP job; `includeReferences=false` disables this addition. UI reads use only bounded database snapshots. Auction price references use recorded bids from completed, compatible native drafts and the same budget; pick-order ADP is never treated as an auction price.
- Preparation shows a searchable top-100 reference subset. Selected archives show references for their own drafted players and an explicit earlier/later ADP difference when a pre-start observation exists. Source attribution, effective/retrieval dates, unavailable samples, observed historical-season rules and current identity mappings are disclosed.
- New native starts preserve version-2 canonical identities, verified aliases, component stat rates and projection units before selections. Draft-day component reports rescore the preserved rates with frozen league rules, optimize legal overlapping flex lineups, show starter strength and bench value over a league-wide starter-demand replacement proxy, and use tie-aware relative ranks only with complete comparable coverage.
- Results reports distinguish recorded starter contribution from production while rostered. Commissioner refresh for verified imported NFL drafts validates source league, season, selections and receiving rosters, then retrieves weekly rosters and player points. Exhaustive provider rosters can establish no contribution to the original team after a player departs. An owned player with absent points remains unavailable. Provider-scored periods remain provisional; snapshots are appended and dated.
- Help controls explain references, scoring, source verification and weekly contribution. Tables scroll within their panels; touch targets and keyboard focus use the existing accessible control conventions. English/Spanish UI is included.

## Production data operations

The preceding archive migration preserved 248,792 guarded metadata updates. A subsequent read-only diagnostic found 32 unresolved leagues: 970 examined facts matched multiple source drafts, and 11 league/source reads were unavailable. No round-only mismatch justified changing a raw selection.

This release captured four market formats for October 3 plus ten historical draft dates, and eight current ADP boards containing 10,768 entries across formats. The two-draft results rehearsal and application produced one comparable provisional report and one partial report, covering six draft-week observations in the operation summary. These are bounded examples, not a claim that every league has complete results.

Commands are dry-run by default and print aggregate counts only:

```text
scripts/sync-draft-references.ts --historical
scripts/backfill-draft-results.ts --limit=2
scripts/diagnose-draft-archive.ts
scripts/verify-draft-analysis-read.ts
```

Writes require `--apply`; verified production writes additionally require `--production`. No schema migration, historical pick deletion or grading backdate is included.

## Validation and release

Local regression: 91 tests across 14 suites passed; implementation lint passed. The reset-attempt fixture loads its service before test timing and mocks the unrelated UI barrel; its assertions remain unchanged. The local scoped type traversal includes known unrelated baseline errors; protected-main TypeScript ratchet must pass before merge. Protected PR checks, Railway success and the served version/health check establish release completion.

Rollback: revert the implementation PR. Observations remain additive and isolated under `draft_reference` / `draft_results`; they do not replace compatible native ADP history or original draft facts. Stop reference refresh with `includeReferences=false`; commissioner refresh does not run during page rendering.

## Still requires separate completion

- Older draft-time component projections and exact historical clocks cannot be reconstructed when the provider never supplied or preserved them.
- Source-unavailable and duplicate/ambiguous legacy facts need verified provider recovery or commissioner evidence.
- Dynasty, keeper and rookie team-strength ranks need verified pre-existing roster coverage; drafted players alone are insufficient.
- Weighted overall letter grades, calibrated win odds, draft-cost opportunity models, asset-lineage valuation and eligibility-aware replay/counterfactuals remain outside this descriptive component release. Proposed roadmap weights are not presented as validated models.
- Actual iOS/Android/tablet and authenticated visual QA remains open. Fixtures and responsive CSS are not physical-device validation.

## Research and source terms

[FantasyPros Draft Analyzer](https://draftwizard.fantasypros.com/football/draft-analyzer/) supports component-based roster analysis and replacement-value comparisons; it does not validate AllFantasy's weights. [Fantasy Football Calculator](https://help.fantasyfootballcalculator.com/article/34-average-draft-position-adp-data) documents format-dependent ADP and history. [Stats Guy Fantasy API documentation](https://statsguyfantasy.com/developers/docs) documents four valuation formats, historical day precision and rate limits; its [terms](https://statsguyfantasy.com/terms) permit commercial API integrations with visible linked attribution. Its values are market references, not ADP, league-exact projections or a validated grading model.
