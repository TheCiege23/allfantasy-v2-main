# Next-Season Creation — Atomic Transaction Design

## Isolation

`prisma.$transaction(callback, { isolationLevel: 'Serializable' })` — the strongest isolation Postgres/Prisma supports, matching the pattern already established and physically proven in `tradeReversalService.ts`.

## Steps inside the single transaction (real, from `lib/redraft/renewal/createNextSeason.ts`)

1. Fresh read: league (with teams, for authorization), source season, source rosters, playoff bracket status, existing renewal row.
2. Re-run `evaluateNextSeasonEligibility` against this freshly-read data (not the pre-transaction read, which could be stale by the time the transaction acquires its locks).
3. If an existing renewal already has `nextSeasonId` set, return `already_created` immediately (idempotent short-circuit, still inside the tx to keep this check serializable-consistent with everything after it).
4. If ineligible, emit `RENEWAL_BLOCKED` and write an audit row, return `blocked` — no destination-season object is created on this path.
5. Create the destination `RedraftSeason` row.
6. Create one destination `RedraftRoster` row per source roster (ownership preserved, all mutable per-season stats reset to schema defaults).
7. Emit `EVENT.NEXT_SEASON_CREATED` via `getPlatformEvents().emitInTx(tx, ...)`.
8. Write the `LeagueAuditLog` row.
9. Create or update the `LeagueRenewal` completion evidence (`nextSeasonId`, `nextSeason`, `priorSeasonId`, `completedAt`, `settingsSnapshot`, counts, idempotency/event/audit ids).
10. Return the `CreateNextSeasonResult`.

Nothing outside this callback performs a write. No notification, cache invalidation, or external call happens before the transaction commits (none were implemented at all this phase — see the Release Readiness doc's Part 12 disposition).

## Steps from the brief's 24-item list not implemented this phase

Draft configuration (step 17), schedule configuration (step 18), and playoff configuration (step 19) initialization are not performed — the result's `draftStatus`/`scheduleStatus` are honestly returned as `'deferred'`, and `limitations` explicitly states why. Locking/conditionally-claiming the source season (step 1) is implemented implicitly via Serializable isolation's own conflict detection (a genuine lock-and-claim primitive, physically proven safe in the N1 concurrency test) rather than an explicit row-level `SELECT ... FOR UPDATE` or conditional `updateMany` guard on the source season itself — a real, disclosed design difference from the brief's literal wording, chosen because Serializable isolation already provides the safety property the explicit lock would have provided, without an extra round-trip.

## What "atomic" means here, proven not assumed

Physically demonstrated (see `NEXT_SEASON_PHYSICAL_VALIDATION_REPORT.md`): a real happy-path run created exactly one destination season with exactly the right roster count, linked evidence, event, and audit, all in one commit. A real N1 concurrency run (two identical concurrent requests) produced exactly one destination season, exactly the right roster count (not doubled), exactly one event, and exactly one renewal row — the losing transaction was rejected outright by Postgres's serializable-conflict detection before any partial write could land.
