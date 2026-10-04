# Draft HQ project plan

Updated October 3, 2026. Scope: universal Draft HQ, league Draft HQ, linked My Team summaries, and explanatory help. Draft HQ owns past, current, and future drafts; league creation configures the initial draft and hands off here.

## Delivery status

Phase 1 shipped on October 3, 2026 through PR #1975. All required GitHub checks passed, including all four unit shards, TypeScript ratchet, draft-room regression, mobile smoke and onboarding/referral/retention browser checks. Focused local validation covered 82 tests across eight suites plus implementation lint. The Phase 1 release served commit 010a01cc60e6a0f8c67abd74bc3ca28dd6e655f4; /api/health returned HTTP 200 with ok=true. Authenticated Draft HQ visual and physical-device checks remain tracked follow-up work. Existing unrelated workspace changes were preserved. Phase 2 has started on its own branch and is not a completed production phase.

## Current completion work — October 4, 2026 UTC

Phase 3 core and the Phase 2 importer foundation shipped through PR #1992 (merge e941de758a0d78a8b8a4f7ca36053da408f2c377). All 17 required checks passed; Railway deployment 44e6b41e-1a49-4451-8b4f-51349148249c succeeded and the public SHA and health checks confirmed the release. This was a core release, not completion of every original Phase 2/3 item.

The completion branch adds individual draft selection, universal catalogue search/season filters/pagination, selected-draft ownership and identity records, permission-gated corrections, timeline pagination and preserved reset attempts. Native start/pause/resume/selection/reset/trade/auction events are persisted with draft mutations. Original scoring, roster rules, teams and existing roster data are frozen at native start. Historical pages suppress current-draft controls and unbound imported boards/grades.

The v2 preparation namespace excludes earlier capture-time settings from verified historical cohorts. Draft-start context must match; benchmarks must predate the draft, and missing data stays unavailable. Private ordering and dispersion preferences now sync per authenticated account, league and native draft, with a visible local fallback on failure. They never edit the live queue. External platform/consensus exports, observed auction-value cohorts and dynasty market values still require compatible source data. A provider-access question is pending; no feed has been invented or purchased.

Phase 4 has started with immutable, bounded captures of available generic PPR season baselines. They are explicitly not custom-scoring grades. Draft-day and results-to-date readiness are separate, versioned and show Insufficient data until league adjustment, player identity, replacement levels and contribution coverage are verified. Production grading weights and predictive claims remain unvalidated.

Validation so far: the latest focused run passed 110 tests; another 34 importer, privacy/attempt-boundary and Spanish tests passed; 10 preparation-sync and start-cutoff tests passed. Wider draft regression passed 2,457 tests; new fixture failures were repaired, known baseline failures were not reclassified. The first CI run identified an incomplete manager-swap event payload, now corrected. A read-only database smoke check found 58 records across 20 sampled leagues and loaded five selected drafts. The legacy provenance rehearsal uniquely matched 756/756 selections from two leagues; the controlled production application updated all 756 with zero conflicts or failures. Legacy backfill is additive, bounded, compare-and-swap guarded and never deletes picks; ambiguous source identity remains unresolved. Final protected-main CI, merge and served-production verification remain pending. Fixture browser checks cover 320/390/768/1440 widths and help hover/pinning/Escape/Close; authenticated browser access is currently unavailable because the computer-use kernel fails its Windows ACL startup. Physical-device QA remains tracked.

## Phase 1 — Correctness and explanations

Priority: critical. Effort: small to medium. User value: selections and ownership can be trusted.

- Preserve multiple selections acquired by one manager in a round. Grid identity is the overall pick; original slot columns stay stable.
- Use the stored next-pick cursor instead of the number of recorded selections.
- Resolve order and trades with the draft engine, including linear, snake, and third-round reversal. Avoid inventing an auction turn from snake order.
- Universal overview selects the latest session per league, matching the current league route; historical sessions do not duplicate cards or corrupt league counts.
- Show native pick inventory as owned, acquired, or traded away. State that imported ownership can have incomplete coverage.
- Recognize configuring/configured states, avoid calling an expired state complete, suppress paused countdowns, and remove misleading slot advice.
- Label existing actual-production grades as results grades; distinguish latest imported history from the current native board.
- Add a reusable circled question mark for ambiguous concepts, with hover, click/touch, keyboard focus, Escape, outside dismissal, and explicit Close. Portal positioning keeps explanations inside the viewport.

Acceptance: regression fixtures cover two picks owned by the same team in one round, a traded OTC pick, unsorted slot arrays, 3RR, missing picks, multiple sessions per league, unsupported auction ordering, paused clocks, and help interaction. Automated interaction checks are required before release. Authenticated visual and actual device checks remain a tracked acceptance task when browser access is available.

Remaining phase-1 follow-up: check real provider fixtures for every supported draft format and confirm ownership coverage. The universal overview remains current-only; the phase-2 archive introduces explicit historical selection. Empty/unsupported/unavailable service states and missing-data grading are addressed below.

## Phase 2 — Durable history and archive

Started on `codex/draft-hq-phase2-archive-20261003`. First slice preserves Sleeper source draft/league IDs, immutable raw selection ownership, player identity, draft settings/order, season settings snapshots and full provider traded-pick ownership records. Provider start and last-picked times retain their original meaning; exact per-pick OTC remains unavailable. The shared draft snapshot is stored once per draft. Verification: 23 importer/provenance tests passed; metadata typecheck and implementation lint passed. Failed provider reads now preserve stored history and report an error. This foundation shipped in PR #1992. The completion branch described above adds selectors, section binding, native clock events, corrections/trade timelines and controlled backfill; release validation remains in progress.

Dependency: phase 1. Effort: large. User/business value: complete league history and trustworthy commissioner archives.

1. Introduce a normalized draft identity: internal ID, provider/source draft ID, season, sport, draft purpose, format, and league lineage across provider seasons.
2. Make routes select a draft explicitly, with league-scoped authorization. Current draft is the default; invalid or inaccessible draft IDs return a clear recovery state.
3. Bind every section to that same selected draft. Prevent a startup and rookie draft in the same year from merging. Keep native and imported duplicates from appearing twice.
4. Add universal search/filter/pagination and league season/draft selectors. Keep query count bounded for large accounts and fetch full picks only on demand.
5. Preserve manager/team names, player club/position, scoring rules, roster rules, order, and keeper costs as draft-time snapshots.
6. Preserve provider ownership records rather than logging their count. Store original owner, owner at selection, selecting actor when known, complete linked transaction packages, and provenance.
7. Preserve commissioner corrections with actor, time, reason, before/after values. Do not overwrite historical records when current rosters change.
8. Record start/end timestamps and clock start/pause/resume/reset/selection events. Measure elapsed duration separately from active duration; expose coverage.

Data contract per pick: draft ID, overall, round, pick-in-round, original slot/roster, receiving roster at selection, selecting actor, player/asset ID, draft-time identity, selected time, selection source, keeper status, auction price, trade references, clock allowance, actual active OTC, and source confidence/coverage.

Timing: imported database creation times are ingestion times, never assumed selection times. Import exact OTC only when the provider supplies sufficient events. Otherwise display “Not supplied by provider.” OTC ownership changes may split timing across managers; preserve both slot total and per-owner portions.

Acceptance: startup plus rookie drafts in the same season remain separate; multiple seasons resolve correctly; native/imported duplication is prevented; current ownership never rewrites selection ownership; imports are idempotent; unreadable history produces a retryable error rather than “no draft.” Verify mappings with provider-specific fixtures before a backfill.

## Phase 3 — ADP and league-adjusted pre-draft preparation

Implementation v1 shipped in PR #1992; its protected-PR checks and production verification passed. Local validation: 142 tests across 12 suites passed and implementation lint passed. Scoped typechecking found no errors in the changed files; existing dependency/baseline errors remain elsewhere. A production read-only initial-capture rehearsal scanned 984 native picks and found two capture-time-settings cohorts covering 84 player rows, with no reported errors. Stored player IDs bind observations and comparisons; names are display labels, and missing IDs receive no benchmark. Synthetic browser previews at 1440px, 768px, 390px and 320px passed document-overflow and help-dialog clipping checks, with no JavaScript errors. These previews are fixtures and do not replace authenticated or physical-device QA. New native ADP observations are appended to existing AiAdpSnapshotHistory records under an isolated draft_hq/hq-v1 namespace. The completion branch introduces hq-v2 and requires original draft-start context; v1 observations are retained but excluded from verified historical comparisons. Context includes exact season, sport, scoring rules, repeated roster slots, team count, player pool, purpose and league type. The existing scheduled recompute also records these observations; scripts/capture-draft-hq-adp.ts supports a bounded dry-run or explicit initial capture (--apply, plus --production for a verified production target) without rewriting existing ADP/history. No new database schema is required. Historical native comparisons require an observation from at or before the verified draft start, and the saved context must match. Imported archive sections remain separate; retrospective current-ADP backfills are not attempted.

The league preparation panel adds observed market rankings, market bands, same-position density, uncovered direct starter slots, sample/range/dispersion, keeper lock costs, remaining-queue and personal-autopick states, browser-local personal ordering/spread preferences scoped by viewer and draft, and a league-scoped what-if mock link. The proposed 45/35/20 pre-draft outlook is explicitly a relative heuristic for supported native redraft/keeper setups; equivalent fresh redraft teams tie. Capital sums inverse square roots of unspent overall picks, keeper strength uses matching observed ADP, flexibility counts unspent picks, and min-max scaling maps equal inputs to 50. Keeper costs and traded ownership use canonical draft-engine resolvers. This is not a forecast or a performance-risk model.

Coverage limits are visible in the product: platform/consensus exports do not yet supply the complete matching context; auction bid-value datasets and draft-time dynasty roster snapshots are unavailable; imported historical ADP depends on unfinished Phase 2 selection/context work. These capabilities remain tracked work and this release does not represent completion of every original Phase 3 data integration. No unsupported source is silently substituted. The universal overview links upcoming drafts to preparation without cross-format portfolio ranking or additional per-league queries. Responsive controls use 44px minimum targets and tables scroll inside their containers; authenticated visual and physical-device verification remains outstanding.


Dependency: phase 2 identity/snapshots. Effort: medium to large. Value: better preparation and repeat usage.

- Version ADP snapshots by provider, timestamp, season, sport, scoring, team count, player pool, and relevant league format. Preserve sample size and dispersion where supplied. Confirm available historical coverage and usage rights before promising backfills.
- Display overall pick minus draft-time ADP: positive means selected later; negative means selected earlier. Separate market discount from decision quality.
- Compare platform, consensus, and AllFantasy ADP when sufficiently matched. Missing benchmarks stay unavailable.
- Connect actual queue and keeper services; show empty, unsupported, and failed-to-load states distinctly. Verify which queue controls autopick and filter taken targets appropriately.
- Add league-adjusted player rankings, tiers, scarcity, roster fit, draft-capital inventory, keeper costs, and what-if mock plans.
- Add pre-draft outlook: initial proposal is existing roster/keepers 45%, draft capital 35%, flexibility 20%, with normalized component scales. Equivalent fresh redraft teams can tie.
- Keep preparation checklist separate from competitive ranking. Personal rankings and risk preferences should be configurable and explainable.

Acceptance: historical picks never use current ADP; superflex/rookie/startup/auction formats cannot silently use incompatible benchmarks; auction uses value-versus-price; a missing ADP source does not generate a grade; all values have provenance and help.

## Phase 4 — Draft-day and results analysis

Dependency: phases 2–3. Effort: large. Value: actionable AI analysis and credible premium reports.

- Freeze draft-day projections and rankings. Proposed draft-day grade: projected roster strength 40%, opportunity value 25%, roster construction 20%, depth/upside 15%.
- Separate results-to-date grade: proposed actual value above replacement 50%, useful weekly contributions 30%, sustained contribution 20%. Validate definitions and weights against historical cohorts before release.
- Use league scoring, starting slots, position replacement levels, draft capital, keeper costs, and auction expenditure. Keep dynasty future value distinct from immediate production.
- Replace no-data C grades with “Insufficient data.” Publish team-level coverage and scoring approximation; normalize current and initial grades using their respective covered picks.
- Show team rankings, component scores, positional strengths, roster gaps, market discounts, opportunity costs, and model version.
- Add Chimmy explanations grounded in the selected draft and source facts. Tie findings to waiver, trade, lineup, and future-draft actions.
- Link trades into asset lineages: original pick → transaction package → selecting team → player → later transactions. Pending future assets stay unresolved rather than receiving a fabricated outcome grade.
- Add replay and counterfactual analysis that only considers players available at the time and clearly marks simulation assumptions.

Acceptance: no hindsight leaks into draft-day grades; missing data cannot look like average performance; confidence reflects coverage; ranks reproduce from published components; limited-production seasons are labeled provisional; report sections agree on draft and season.

## Phase 5 — Responsive Draft HQ and My Team integration

Dependency: stable phase-2 contracts; can proceed alongside analysis after data contracts settle. Effort: medium to large. Value: daily usability across consumer and commissioner workflows.

- Context bar: league, season, individual draft, sport, format, status, freshness.
- Navigation: Overview, Board, My Picks, Rankings, Trades, Timeline. Summaries adapt to upcoming/live/completed state.
- Desktop: wide board, sticky column headers and round labels, density control, side inspector, optional Chimmy dock.
- Phones: chronological feed or My Picks by default; optional landscape board; team/round filters and bottom-sheet pick details.
- Tablet: collapsible inspector in portrait; board plus analysis in landscape; support split-screen and hardware keyboards.
- Every selection has accessible expandable details. Full names and explanations work without hover.
- Universal My Team: draft origins, exposure across teams, compatible-format comparisons, recurring strengths/gaps.
- League My Team: Drafted/Keeper/Trade/Waiver labels with links to originating picks and transactions.
- Performance: bounded portfolio reads, virtualize large boards if necessary, lazy-load headshots, defer full reports, stable scroll positions.

Acceptance matrix: iOS Safari and installed app shell; Android Chrome and installed app shell; desktop Chrome/Edge/Safari where available; tablet portrait/landscape/split-screen; widths 320/390/768/1024/1440; light/dark; enlarged text; keyboard; VoiceOver/TalkBack; reduced motion. Page must not scroll horizontally outside the board.

## Phase 6 — Recaps, sharing, future drafts, and organizations

Dependencies: trustworthy history and grades. Effort: medium initially, larger for organizations. Value: retention, community growth, B2B reuse.

- CSV/PDF/share-card exports with source dates, grade basis, ownership, and privacy controls.
- Optional emoji badges with text and explicit conditions. Market discount is not automatically a proven steal.
- User-triggered GIF/reaction playback with static fallback, reduced-motion support, provider availability checks, and restrained loading. Keep animation out of timed selection controls.
- Future-year draft asset boards: unresolved picks identify season/round/original team, without inventing an exact slot.
- League creation configures the first draft and links to Draft HQ. Subsequent rookie/supplemental/dispersal drafts reuse the same lifecycle and engine.
- Organization/creator mode: permissioned archives, brandable reports, commissioner dashboards, reusable exports, and subscription entitlements after the consumer experience is stable.

Acceptance: private leagues are not exposed by share links; exports match the selected draft; future orders remain provisional; animations are optional; organizations use the same canonical data rather than a second draft implementation.

## Circled question mark standard — every phase

Use one reusable control next to concepts that require interpretation: draft format/3RR, original slot and acquired ownership, keeper cost, ADP source/difference, auction value, projected/actual grades, confidence/coverage, scoring approximation, OTC allowance versus elapsed/active time, automated selections, simulations, ranking order, and freshness.

Each explanation answers: what it means, how it is calculated or behaves, and any relevant limitation. Use an example when it resolves ambiguity. Add it once per concept/section rather than in every repeated pick cell. Essential errors and missing-data notices remain visible without opening help.

Desktop hover and keyboard focus reveal the explanation. Click/touch pins it. Escape, outside interaction, a second click, and Close dismiss it. Keep text inside viewport boundaries, preserve focus, and expose accessible names/expanded state. Touch targets are at least 44px. Future popovers with actions require explicit focus management.

Draft HQ gets this standard first. Extend it to My Team and the remaining Core surfaces through a separate concept inventory; do not claim a sitewide rollout from the initial Draft HQ integration.

## Release order and ownership

User-authorized release policy (October 3, 2026): deploy each completed phase to production. Use an isolated branch and protected-main PR; run required checks, merge, verify Railway build success, and confirm the served commit and health before declaring that phase shipped. No additional deployment confirmation is needed within this scope. Incomplete work remains on its own branch and must not be described as a completed phase.

| Milestone | Responsible functions | Release gate |
|---|---|---|
| 1. Correctness | Frontend + draft runtime engineering | Regression tests, types/lint, required CI; visual QA tracked |
| 2. History | Backend/import engineering + commissioner product | Schema review, provider fixtures, staging backfill rehearsal |
| 3. Preparation/ADP | Data + draft engineering | Snapshot/format validation, source coverage |
| 4. Analysis | Data/model engineering + Chimmy product | Hindsight checks, reproducibility, cohort validation |
| 5. Responsive UX | Frontend/design + QA | Device/accessibility/performance matrix |
| 6. Community/B2B | Product + frontend/backend | Privacy, entitlement, export fidelity |

Effort labels describe relative complexity, not calendar commitments. Provider history coverage and historical ADP availability are the main discovery dependencies. Estimate dates after those checks and schema scope are settled.

Measure: missing/duplicate picks (target zero), ownership mismatch rate, draft-selection consistency, import coverage by field/provider, ADP coverage, report load latency, help usage, board-to-report usage, and follow-through on recommended team actions. Separate usage metrics from claims about predictive accuracy.

## Research informing the plan

Refreshed for Phase 3 on October 3, 2026: FantasyPros documents personal cheat sheets, team needs, position scarcity and tracking remaining tier players; its Draft Wizard documentation also connects custom rankings with mocks and keeper costs. This supports making preparation actionable. It does not validate our proposed outlook weights or transform ADP bands into projection tiers.

- https://support.fantasypros.com/hc/en-us/articles/115001308567-What-is-the-Draft-Assistant
- https://support.fantasypros.com/hc/en-us/articles/115001300547-What-is-Draft-Wizard


- Sleeper previous boards: https://support.sleeper.com/en/articles/4035696-how-can-i-view-previous-drafts-in-my-league
- Sleeper traded ownership: https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks
- Sleeper API coverage: https://docs.sleeper.com/
- FantasyPros analysis: https://draftwizard.fantasypros.com/football/draft-analyzer/
- Footballguys league settings/strategy: https://sportsguys.zendesk.com/hc/en-us/articles/51940133394203-Draft-Dominator-V3-Entering-The-Draft-Room-Onboarding
- ADP methodology: https://help.fantasyfootballcalculator.com/article/34-average-draft-position-adp-data
- Qualitative asset-history request: https://www.reddit.com/r/SleeperApp/comments/1rtp8nh/pick_transaction_history_addition/

These sources were consulted for the preceding audit. Refresh research before major model and product releases. Community posts are qualitative signals, not prevalence estimates.
