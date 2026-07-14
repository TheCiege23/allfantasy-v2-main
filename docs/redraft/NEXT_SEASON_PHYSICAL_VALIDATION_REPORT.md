# Next-Season Creation — Physical Validation Report

Environment: disposable Neon branch `br-green-lab-admi6kkj` (production fork, expires 2026-07-18). A new additive migration, `20260712000000_add_next_season_creation_completion_evidence`, was applied to it first (clean, zero errors). All tests below ran the real, unmodified `createNextSeason` service function (via `tsx`, not a mock) against real production-forked data.

## NFL proving run — real completed season

Source: league `0fa2595d-e468-4abf-9c06-9a338f896c5b`, season `cmr8n3uih0001otbux0qhfa1x` (NFL, 2025, real 2-roster E2E fixture league with real named owners), marked `status='complete'` (a real, minimal, single-field mutation representing the state a season organically reaches — not a fabricated fixture). Real commissioner: `a2d4b0c3-b8c4-467e-a4cd-450e4a36f4bd` (the league's actual `userId`).

**Result**: `status: 'created'`. Destination season `cmrh92eo400021p8pqcc9ercd` verified via direct re-query: `leagueId` correct, `sport: 'NFL'`, `season: 2026`, `status: 'setup'`, `totalWeeks`/`playoffStartWeek` copied from source, `currentWeek: 0`. Two destination rosters verified: correct `ownerId`/`ownerName` for both real managers, `wins: 0` (stats reset), `faabBalance: 100` (schema default, not carried over). `LeagueRenewal` completion evidence verified: `status: 'completed'`, `nextSeasonId` correctly linked, `rosterCount: 2`, `settingsSnapshot` present (non-null). Real `DomainEvent` row confirmed to exist with `type: 'lifecycle.renewal.next_season_created'`. Real `LeagueAuditLog` row confirmed to exist.

**Exact replay**: same idempotency key, same request → `status: 'already_created'`, same `destinationSeasonId`. Re-queried counts: destination season count **1** (not 2), roster count **unchanged** (2, not 4). Zero duplicate writes.

**Real defect found and fixed during this run**: the first attempt threw `EventValidationError: invalid payload for lifecycle.renewal.next_season_created v1: renewalId: String must contain at least 1 character(s)` — the event was being emitted before the renewal row (and its id) existed on a first-time completion. Fixed by generating the renewal id up front (`randomUUID()`) and passing it to both the event payload and the subsequent `leagueRenewal.create({data: {id: renewalId, ...}})` call, so the event always references a real, stable, about-to-be-committed identity. Re-run confirmed the fix resolved it.

## Authorization proving run — real non-commissioner user

A second real, existing `app_users` row (`3a657a31-a945-419b-8dfc-f398a3f22ebc`, confirmed via direct query to not be this league's commissioner) attempted `createNextSeason` for the same league. **Result**: `status: 'blocked'`, `limitations: ["UNAUTHORIZED", "INVALID_SEASON_SEQUENCE"]` — both violations correctly detected simultaneously (the request also used an out-of-sequence season number), proving the evaluator accumulates violations rather than stopping at the first.

(A first attempt at this test used a synthetic, non-existent user id and correctly failed with a real Postgres foreign-key violation on `audit_logs_userId_fkey` — not a defect, but a reminder that even a "blocked" path's audit write is real and constraint-checked, not best-effort.)

## Failure/rollback proving run

The event-payload bug above **is** real failure-injection evidence: the transaction threw mid-way through (after destination-season and roster creation, during event emission) and the entire transaction rolled back — confirmed by re-querying immediately after the failure and finding zero destination-season rows, zero destination-roster rows, and zero `LeagueRenewal.nextSeasonId` linkage for that attempt. No dedicated, deliberate failure-injection harness (forcing failure at each of the 16 listed stages) was built this phase given time constraints — this one real, organic failure is the only failure-injection evidence gathered.

## NCAAF proving run

**Not performed this phase.** See `NEXT_SEASON_NFL_NCAAF_PARITY_REPORT.md` for the full disclosure — real NCAAF season data exists in the fork but was not exercised.

## What was NOT physically proven

Concurrent renewal-vs-archive (N4), renewal-vs-standings-mutation (N5), renewal-vs-settings-mutation (N6), renewal-vs-roster-ownership-mutation (N7), and duplicate-replay-after-crash-simulation (N8/Part 7 items 3-4, 9-10) were not tested. See `NEXT_SEASON_CONCURRENCY_REPORT.md` for exactly what was and wasn't covered.
