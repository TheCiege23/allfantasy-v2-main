# Gate C Renewal Fixture Catalog

## Honest scope statement, up front

The full 9-fixture catalog specified in this phase's brief (NFL-1 through NFL-6, NCAAF-1 through NCAAF-3, covering tied standings, archived source seasons, already-renewed seasons, partially materialized destinations, and calendar edge cases) was **not built this phase**. Given the phase's `NEXT_SEASON_CREATION_EXECUTION_AUDIT.md` finding that next-season creation does not exist in the codebase at all, several of the specified fixtures (NFL-4 "already renewed," NFL-5 "partially materialized destination") describe states of a feature that has no code path to reach them — building fixtures for an operation that cannot run would not produce real evidence. Building the full fixture catalog anyway, disconnected from any operation that consumes it, was judged lower value than the time spent on the trade-concurrency matrix (which found and fixed a real defect) and the three audit tracks.

## What was actually used this phase

Real, pre-existing production-forked data already present on the disposable branch (unchanged from the prior phase): 12 real redraft seasons (10 NFL, 2 NCAAF), 48 real rosters, 11 real trade proposals in varying real states. This data was used directly for the concurrency matrix (`TRADE_CONCURRENCY_PHYSICAL_MATRIX.md`) — real rosters, real players, real FAAB balances, real proposal records created via the same schema/constraints real production traffic would hit.

## What this means for renewal-specific physical validation

Zero renewal-specific physical test scenarios (tied standings, archived source, calendar edge cases) were executed this phase. This is a real, disclosed gap. The two renewal migrations themselves were physically validated (schema application, both from-empty and upgrade path — see `GATE_C_EMPTY_DATABASE_MIGRATION_REPORT.md` and the prior phase's `RENEWAL_MIGRATION_EXECUTION_REPORT.md`), but no renewal *business logic* fixture testing occurred, because — per the Part 4 audit — there is no renewal business logic beyond opening a window and collecting decisions to test against fixtures in the first place.

## Recommendation for the next phase

Once next-season creation is actually implemented (a real, separately-scoped feature build, not this phase's job), build the fixture catalog specified in this phase's original brief against that real implementation, rather than against fixtures for a feature that doesn't exist yet.
