# Next-Season Creation Call Graph

## Pre-existing lifecycle (verified unchanged from the prior phase's audit, re-confirmed by direct read this phase)

```
POST /api/redraft/renewals              -> openRedraftRenewal()   [implemented and called]
POST /api/redraft/renewals/[id]/decision -> decideRedraftRenewal() [implemented and called]
```

Both remain real, commissioner-gated, transactional, and idempotent-on-open. Neither creates a destination season — confirmed again this phase (`nextSeasonId` was `null` for every real renewal row queried before this phase's work).

## New this phase

```
createNextSeason(input: CreateNextSeasonInput)
  lib/redraft/renewal/createNextSeason.ts
  -> pre-transaction idempotency check (leagueRenewal.findUnique by completionIdempotencyKey)
  -> prisma.$transaction(Serializable)
       -> fresh re-read: league, source season, rosters, playoff bracket, existing renewal
       -> evaluateNextSeasonEligibility()  [lib/redraft/renewal/nextSeasonEligibility.ts]
       -> if ineligible: emit RENEWAL_BLOCKED, write audit, return `blocked`
       -> tx.redraftSeason.create()        (destination season)
       -> tx.redraftRoster.create() × N    (destination roster shells, ownership preserved)
       -> emitInTx(EVENT.NEXT_SEASON_CREATED)
       -> tx.leagueAuditLog.create()
       -> tx.leagueRenewal.create() / .update()  (completion evidence: nextSeasonId, settingsSnapshot, counts, idempotency/event/audit ids)
       -> return CreateNextSeasonResult { status: 'created', ... }
```

**Not yet wired to a customer/API route** — this phase implemented and physically validated the service function directly; Part 17 (API surface) was not reached given time constraints. This is disclosed, not claimed as done.

## Classification of every required action (per the brief's own taxonomy)

| Action | Classification |
|---|---|
| Renewal proposal creation, commissioner decision, authorization | Implemented and called (pre-existing) |
| Source-season completeness check | Implemented and called (new, `evaluateNextSeasonEligibility`) |
| Archive check | **Absent** — eligibility does not require the source season to already be archived; archiving is not integrated (see Part 10 disposition below) |
| Destination-season creation | Implemented and called (new) |
| Source/destination linkage | Implemented and called (new — `LeagueRenewal.nextSeasonId`/`priorSeasonId`) |
| Roster creation | Implemented and called (new) |
| Manager ownership | Implemented and called (new — preserved `ownerId`/`ownerName`) |
| Settings copying | Implemented and called (new — `settingsSnapshot` JSON copy of `League.settings`) |
| Scoring copying | Implemented and called (new — scoring lives inside the same `League.settings` blob in this codebase's real architecture, not a separate field; see the Contract doc) |
| Schedule initialization | **Absent, explicitly deferred** |
| Waiver initialization | Implemented and called (new — `waiverPriority`/`faabBalance` reset to schema defaults) |
| Draft configuration | **Absent, explicitly deferred** |
| Playoff configuration | **Absent, explicitly deferred** |
| Event emission | Implemented and called (new — `EVENT.NEXT_SEASON_CREATED`/`EVENT.RENEWAL_BLOCKED`) |
| Audit creation | Implemented and called (new) |
| Notification delivery | **Absent** — no post-commit notice was implemented this phase |
| Idempotency | Implemented and called (new, physically verified — exact replay returns the original result, zero duplicate writes) |
| Retries | Partially implemented — the transaction itself is retry-safe (idempotency key), but a losing concurrent request currently surfaces a raw Postgres serialization error rather than a clean retryable response (see Concurrency Report) |
| Conflict handling | Partially implemented — `CONFLICTING_IDEMPOTENCY_PAYLOAD` is detected for a reused key against a different source; a true concurrent double-submission currently throws rather than returning `status: 'conflict'` gracefully |

## Archive integration disposition (Part 10)

Per this phase's explicit scope guardrail ("implement only the archive behavior required to safely support next-season creation... do not attempt a broad archive UI redesign"), archival was **not integrated into eligibility this phase**. The eligibility evaluator gates on `season.status === 'complete'` (the same signal `enterRedraftOffseason` already uses) rather than requiring `League.lifecycleState === 'archived'`. This is a real, deliberate, disclosed scope decision: integrating the already-known-unsafe `archiveLeague` operation (non-transactional, no completeness gate, override-bypassable — see the prior phase's `SEASON_ARCHIVE_ARBITRATION_REPORT.md`) into this new transaction would have imported its defects into next-season creation. Next-season creation today can run against a *completed but not archived* source season — a real, intentional gap, not an oversight.
