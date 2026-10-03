# Draft HQ project plan

Updated October 3, 2026. Scope: universal Draft HQ, league Draft HQ, linked My Team summaries, and explanatory help. Draft HQ owns past, current, and future drafts; league creation configures the initial draft and hands off here.

## Delivery status

Phase 1 is integrated with current main in an isolated release branch. Verification: 81 tests passed across eight focused and compatibility suites; lint passed for all eight implementation files. TypeScript verification and protected-main CI are in progress. Production deployment and authenticated visual/device checks are not yet confirmed. Existing unrelated workspace changes are outside this delivery. Remaining phases are planned work, not delivered features.

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

Started on `codex/draft-hq-phase2-archive-20261003`. First slice preserves Sleeper source draft/league IDs, immutable raw selection ownership, player identity, draft settings/order, season settings snapshots and full provider traded-pick ownership records. Provider start and last-picked times retain their original meaning; exact per-pick OTC remains unavailable. The shared draft snapshot is stored once per draft. Verification: 23 importer/provenance tests passed; metadata typecheck and implementation lint passed. Failed provider reads now preserve stored history and report an error. This is foundation work, not a completed phase or a production release. Explicit selectors, uniform section binding, native timing events, correction/trade histories and controlled legacy backfill remain outstanding.

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

| Milestone | Responsible functions | Release gate |
|---|---|---|
| 1. Correctness | Frontend + draft runtime engineering | Regression tests, scoped types/lint, authenticated checks |
| 2. History | Backend/import engineering + commissioner product | Schema review, provider fixtures, staging backfill rehearsal |
| 3. Preparation/ADP | Data + draft engineering | Snapshot/format validation, source coverage |
| 4. Analysis | Data/model engineering + Chimmy product | Hindsight checks, reproducibility, cohort validation |
| 5. Responsive UX | Frontend/design + QA | Device/accessibility/performance matrix |
| 6. Community/B2B | Product + frontend/backend | Privacy, entitlement, export fidelity |

Effort labels describe relative complexity, not calendar commitments. Provider history coverage and historical ADP availability are the main discovery dependencies. Estimate dates after those checks and schema scope are settled.

Measure: missing/duplicate picks (target zero), ownership mismatch rate, draft-selection consistency, import coverage by field/provider, ADP coverage, report load latency, help usage, board-to-report usage, and follow-through on recommended team actions. Separate usage metrics from claims about predictive accuracy.

## Research informing the plan

- Sleeper previous boards: https://support.sleeper.com/en/articles/4035696-how-can-i-view-previous-drafts-in-my-league
- Sleeper traded ownership: https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks
- Sleeper API coverage: https://docs.sleeper.com/
- FantasyPros analysis: https://draftwizard.fantasypros.com/football/draft-analyzer/
- Footballguys league settings/strategy: https://sportsguys.zendesk.com/hc/en-us/articles/51940133394203-Draft-Dominator-V3-Entering-The-Draft-Room-Onboarding
- ADP methodology: https://help.fantasyfootballcalculator.com/article/34-average-draft-position-adp-data
- Qualitative asset-history request: https://www.reddit.com/r/SleeperApp/comments/1rtp8nh/pick_transaction_history_addition/

These sources were consulted for the preceding audit. Refresh research before major model and product releases. Community posts are qualitative signals, not prevalence estimates.
