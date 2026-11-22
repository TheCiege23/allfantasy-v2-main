# Pirate daily lineups and joint move evidence

## Implemented

- Version 3 immutable lock snapshots support NBA, MLB and NHL daily lineups. A penalty requires exact-date saved daily rows before and after lock; weekly layouts and carried-forward days do not certify a missing day. The completed-week assessment reads that same saved Eastern date. A known off-day player cannot fill an active daily slot. Later activity evidence must belong to the same scoring date.
- IR, IL, IL_PLUS, RESERVE and taxi activation witnesses require a jointly certified move plan. Collection previews the same member-save validation, taxi windows and player locks. It verifies the intermediate activation onto the bench and the final full lineup, including shared bench and active-roster capacity. Previews do not persist lineup saves or promotion history.
- Combined immediate acquisitions are checked sequentially against a virtual roster. Every step repeats the manager-specific acquisition gates. Projected canonical validation shares capacity, distinct drops, undroppable restrictions, drop budgets and acquisition budgets. Pending competitive claims do not count as available pickups.
- The matching evaluator validates the plan's actual complete assignment, including equivalent repeated slots, distinct players and immovable locked starters. Independent successful pickup checks are never assumed to form a joint plan. Both snapshots must retain the identical certified plan; future replacements also require activity evidence at their own game lock.
- Commissioner evidence shows the Eastern scoring date and named ordered add/drop/activation steps. Unverified cases keep protections for review. Evidence collection makes no roster transfers.

## Deliberate review boundaries

Search is bounded to three move steps, 128 explored states, 12 feasible plan checks, eight reserve candidates and 24 relevant waiver candidates (up to three per primary position). Pickups precede reserve activation and the final lineup save. Exhaustion, a refused intermediate state, missing daily rows, stale/ambiguous injury data, unsupported reserve types, or an incomplete waiver pool preserve protections for commissioner review. The engine never interprets an incomplete search as proof that no replacement existed.

## Staging verification

The existing additive `20261020120000_daily_lineups` migration was applied through the guarded allowlisted staging runner to the separate winter-salad database. Production migrations were not run.

Local release checks passed: 92 distinct focused rule/UI/guard tests, changed-source ESLint, and scoped TypeScript with zero changed-source diagnostics. The scoped compiler still reports 41 existing diagnostic lines elsewhere in the repository.

`lineup-evidence-staging.json` records disposable synthetic fixture assessment across all four sports, including reserve plans and joint acquisitions, exact saved-date reads for the three daily sports, missing-proof retention, commissioner restoration and renewed winner selection. These constructed snapshots test persistence and ruling paths; they are separate from real provider observations and the ongoing real-game rehearsal. Fixture leagues and QA users are removed by the harness.

The ongoing real-game fixture, scheduled workers and provider data remain in place. Real scoring-period finalization, a real 24-hour claim response/transfer, physical Android testing, and production sign-off remain acceptance gates. See `live-rehearsal-operations.md`.
