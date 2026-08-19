# Next-Season Creation — Failure Injection Report

## Honest scope statement

The brief lists 16 required failure-injection points across next-season creation, archive, week-advancement, and concurrency, plus post-commit failure testing. Given severe time constraints in a phase whose primary deliverable was the atomic transaction itself (a genuine feature build, not present in the codebase at all before this phase), a dedicated failure-injection harness (deliberately throwing at each of the 16 stages) was **not built**. This is disclosed directly rather than fabricated.

## Real failure evidence gathered incidentally

One real, organic transaction failure occurred during physical testing (see `NEXT_SEASON_PHYSICAL_VALIDATION_REPORT.md`): an event-schema validation error thrown partway through the transaction (after destination-season and roster creation, during event emission). Re-querying immediately after confirmed:

- Zero destination-season rows persisted for that attempt.
- Zero destination-roster rows persisted for that attempt.
- `LeagueRenewal.nextSeasonId` remained unlinked.
- No `DomainEvent` or `LeagueAuditLog` row was created for that attempt.

This is real, if incidental, proof that a mid-transaction failure rolls back completely — no orphan destination, no false event, no false audit. It covers exactly one of the 16 listed failure points (event creation) by accident, not by design.

## N1's serialization failure as failure-injection evidence

The N1 concurrency test's losing transaction (see `NEXT_SEASON_CONCURRENCY_REPORT.md`) is a second real, organic failure — a Postgres serialization conflict rather than an application-level throw — and it also produced zero orphan writes, confirmed by direct re-query.

## Post-commit failure testing

**Not performed** — no post-commit effects (notices, cache invalidation, intelligence refresh, schedule-generation requests) were implemented this phase at all (see the Release Readiness doc's Part 12 disposition), so there is nothing post-commit to fail-inject against yet.

## What remains genuinely untested

Deliberate injection at: source lock, archive transition (not applicable — not integrated), destination creation, source/destination linkage, settings copy, scoring copy, roster creation, ownership assignment, standings initialization, waiver initialization, draft configuration (not applicable — deferred), schedule configuration (not applicable — deferred), playoff configuration (not applicable — deferred), audit creation, idempotency persistence. This is a real, substantial gap in this phase's evidence relative to the brief's full ask, disclosed plainly rather than papered over with the two incidental failures above.
