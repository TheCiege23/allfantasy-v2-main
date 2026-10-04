# Draft HQ: broader Phase 4

The selected archive now exposes team components, frozen-roster dynasty/keeper analysis, pick replay, recorded asset transfers and weekly original-team player contribution. Both universal and league-selected Draft HQ use the same permission-scoped archive. No database migration is required.

## Definitions and publication rules

- Roster strength is the optimal legal starter lineup under the scoring rules preserved at draft start. Existing dynasty/keeper players must have an unambiguous frozen roster binding and preserved projection identity. Missing rosters prevent comparable ranks. Starter improvement measures the after-minus-before lineup baseline.
- Opportunity compares the recorded selection's immediate legal-lineup gain with the best remaining gain at that pick. Earlier picks, frozen existing players and all reserved keepers are unavailable. Later selections are not removed early. The UI compares one substitution; it does not simulate later opponents or claim a season outcome.
- Construction is starting-slot coverage. Completely covered teams tie on this component; it is not an independently predictive strategy score. Depth is positive bench value above the league-wide starting-demand replacement proxy. That proxy does not represent current waiver availability.
- ADP discount is an independent market benchmark: recorded overall minus historical ADP. Positive means selected later than ADP. It is not automatically a good football decision. Missing historical ADP remains unavailable.
- Grades require a compatible model observed before the selected draft, with a holdout season earlier than the selected season. Weights are selected on older independent leagues, with every league kept in one split. Minimum independent league counts are 30 training and 15 later-season holdout. Publication requires at least 10% lower held-out mean absolute percentile error than starter strength alone, and error at most 20 percentile points. These thresholds are internal publication requirements, not externally validated standards. The target is original-team finalized starter-contribution percentile, not wins or championship probability.
- Current dynasty market marks are dated and visibly credited separately from draft-date marks and immediate projected points. No trade profit, allocated package price or future-pick outcome is inferred.
- Asset links require recorded player IDs or season/round/original-owner pick identity. Generic pick assets remain ambiguous when multiple same-season drafts could match. Explicit source IDs must agree. Package size and reversals remain visible; transfers are evidence links, not a proven complete causal ownership chain. Reads above 1,000 packages block instead of silently truncating. Future/unresolved assets are paginated.
- Weekly contribution counts recorded points and actual starts on the selecting team only, after the draft, in all-team finalized weeks. Missing rows are partial, not zero. Usage is starts divided by covered final weeks, not games active. Early/late totals divide observed weeks in half. Weekly replacement VOR requires replacement eligibility evidence and is not inferred from aggregate results.

## Evidence and limits

The production read-only calibration rehearsal on 2026-10-04 examined **zero eligible completed historical v2 cohorts** and wrote no model. Letter grades therefore remain unavailable. Historical current projections cannot reconstruct missing pre-draft projections. Imported aggregate result observations remain separately labeled; they cannot supply individual weekly usage or a calibrated training cohort.

Replay comparisons require complete preserved component scoring, unrestricted eligibility, snake/linear order and supported standard/startup purposes. Auction and restricted rookie pool counterfactuals need additional archived eligibility/budget evidence. Recorded picks remain replayable even when comparisons are unavailable. Missing pick times never acquire a guessed clock.

Local deterministic explanations and links to current lineup, waivers, trades and preparation are included. The proposed new Chimmy provider integration is excluded pending explicit approval to disclose selected private league facts to its existing AI providers.

## Operations

Run `node --env-file=.env.production --conditions=react-server --import tsx scripts/recompute-draft-calibration.ts` for the read-only rehearsal. It prints aggregate counts only. Apply mode additionally requires `--apply --production` against the verified production database identity. No remote provider requests run in this job. More than the candidate limit, failed source reads, incomplete final-week coverage or failed validation block publication. Re-run after sufficient completed seasons with original v2 snapshots accumulate. Model observations are append-only and never backdated. No automatic provider ingestion or new scheduler is introduced.

The release must pass existing protected-branch CI and normal merge requirements before Railway deployment. Verify the served SHA and database health after deployment. Roll back the application commit if archive access, render stability or latency regresses. There are no schema changes to reverse; newly stored calibration observations can remain unused by the prior application.

Responsive fixture validation covers 320, 390, 768 and 1440 CSS-pixel widths, bounded table scrolling, replay selection/search/scenarios, and question-mark hover/click/Escape behavior. This is Chromium fixture testing, not physical iOS/Android testing or authenticated live-league acceptance testing. English and Spanish copy are present.

## Research basis

[FantasyPros Draft Analyzer](https://draftwizard.fantasypros.com/football/draft-analyzer/) motivates transparent component comparisons. [FantasyPros value-based drafting definitions](https://support.fantasypros.com/hc/en-us/articles/115005868747-What-is-value-based-drafting-What-do-player-draft-values-mean-VORP-VONA-VOLS-VBD) distinguish replacement-value baselines from market draft position. Neither source validates AllFantasy's model weights. [Sleeper's official API](https://docs.sleeper.com/) supplies documented original/previous/current pick-owner fields and transaction package identities. [Scikit-learn cross-validation guidance](https://scikit-learn.org/stable/modules/cross_validation.html) supports group/time separation to avoid leakage; [calibration guidance](https://scikit-learn.org/stable/modules/calibration.html) reinforces held-out evaluation before probability claims. The current model deliberately publishes no win probability.

## Remaining follow-through

Accumulate eligible original draft snapshots and completed outcomes before activating empirical grades. Add archived auction and restricted-pool eligibility before those counterfactuals. Add provider-level finalized weekly player/replacement data before imported weekly VOR. Obtain the pending Chimmy disclosure approval before connecting private draft facts to AI explanations. Conduct authenticated league and physical-device acceptance checks when access is available.
