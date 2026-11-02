# Current-main NHL historical evaluator integration

This branch adds historical NHL lineup evidence to current main's server decision
and frozen public receipt. It preserves the newer market grading path for other
sports rather than replacing it with the older local evaluator.

## Scope

- Native and imported NHL points settings, including legacy Fantrax grouped
  scoring settings with distinct goalie and skater weights.
- Exact goalie/skater slot assignment, including Fantrax `FLEX_CW`.
- Two to 128 participating rosters; league size itself is not restricted to 12.
- Provider identity namespaces remain separate. Missing, ambiguous, repeated and
  multiply-owned players block the affected lineup evidence.
- Stored RI regular-season boxes only, tied to final games, bounded to the league
  season and two prior seasons. Game, fetch and update timestamps must not exceed
  the capture time. Every weighted stat must be observed; missing is not zero.
- At least five complete current-season games or ten historical games per player.
  These are sufficient sample gates, not verification of a full season's coverage.
- No provider request is made during evaluation. NHL historical results never
  become asset values, projections, playoff probabilities or contextual grades.
- Receipts retain the historical basis and public coverage counts. Other sport
  grades retain the existing grader. No schema change is needed.

## Verification

Seven isolated NHL scoring/context/receipt tests passed. The scoped TypeScript
check of the NHL data, context and optimizer modules passed. The clean-branch
rollback probe then passed on all 51 real players across three rosters, reproducing
historical deltas -1.91, -2.11 and +2.97. Both temporary trade and snapshot were
confirmed absent after rollback. Projection, outcome and contextual-grade flags
remained false, with market letters null.

An attempted dynamic import optimization caused existing grader regression
timeouts. The original market-module loading order was restored, and all six
existing market-grader regressions passed. Snapshot regressions passed in the
preceding run. The combined rerun also hit two worker-startup timeouts under
shared-machine resource pressure, so no single broad local pass is claimed.

Parent #3165 passed its required checks and merged as
`792d514634689e81cc3133d81c1b36ecb3fc9eb4`. Its production web and cron deployments
reported SUCCESS. Follow-up #3168 also merged as
`b3eb7d6db0d30e71a3b6eea013684754a18ef113`; its web build is pending.
This evaluator integration is not yet deployed and does not establish market grades.
