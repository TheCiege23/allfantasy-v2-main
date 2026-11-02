# Real Fantrax NHL historical lineup receipt

Source league: `u7lhl3f6mvmzwipj`, staging canonical league
`cdecc8d0-0c79-4853-9313-e900cbfb6703`. No provider trade was submitted.

## Bounded history backfill

The new staging runner defaults to read-only and accepts one to three past dates.
It scopes identity resolution to players on this imported league's rosters and
refuses duplicate identity links. Only final regular-season boxes on the requested
Eastern calendar date qualify. Goalie appearances additionally require an exact
official name/team/opponent/date/saves/goals-against join. Existing game rows are
preserved under the same advisory lock used by live refreshes.

After read-only validation, staging inserted 548 current-season game records for
October 10–16, 2026, plus 169 prior-season records from October 16, 2025 and
April 16, 2026. Official goalie enrichment added 65 exact joins. The prior-season
dates are samples, not a complete season. No prior-season completeness is claimed.
A repeat October 13 write found zero candidates and wrote zero rows.

## Authentic three-roster rollback receipt

| Roster | Players | Linked | Scored | Historical lineup delta |
| --- | ---: | ---: | ---: | ---: |
| `720d7371-3d1b-4113-9721-f5b0555766f8` | 16 | 16 | 16 | -1.91 |
| `485c1594-d8f1-4293-a6b9-433664696825` | 18 | 18 | 18 | -2.11 |
| `f4259b7d-d139-4ad1-a48c-1f9603d4f8a4` | 17 | 17 | 17 | +2.97 |

All three lineup rows were verified with zero missing identities, positions or
scored histories. The receipt persisted inside a transaction, and both temporary
trade and snapshot were confirmed absent after rollback. Deltas use historical
league-scored points per game, not future projections. Market grades remain null
because the asset values are unsupported. `projectionsVerified`, `outcomeVerified`
and `contextualGradeAllowed` remain false. This validates three real rosters, not
all 12; other rosters retain identity or history gaps.

The receipt evaluator and roster-selection extension are in the older local
working branch, absent from current main. This branch contains the reusable data
backfill and insert-only writer guard, not a public evaluator deployment.

Validation: scoped TypeScript passed. All 24 writer/live-refresh tests passed,
including a concurrent-row guard.

Next: finish the parent NHL release CI/deployment, port the evaluator to current
main, and expand prior-season/identity coverage before public rollout.
