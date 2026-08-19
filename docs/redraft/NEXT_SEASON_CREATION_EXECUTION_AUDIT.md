# Next-Season Creation Execution Audit

## Real call graph (direct code audit)

```
POST /api/redraft/renewals            -> openRedraftRenewal()
POST /api/redraft/renewals/[id]/decision -> decideRedraftRenewal()
```

Both live in the sole implementation file, `lib/redraft/renewal/CanonicalRedraftRenewalService.ts` (43 lines total). `openRedraftRenewal` (lines 7-26): commissioner-only (`league.userId !== actorUserId` → `FORBIDDEN`), idempotent-on-open (returns the existing `LeagueRenewal` row if one already exists for the league/season rather than duplicating), creates the `LeagueRenewal` row plus one `LeagueRenewalSlot` per manager, transitions league lifecycle to `renewal_pending`, writes an audit log row and a `RENEWAL_OPENED` event — all inside one `prisma.$transaction`. `decideRedraftRenewal` (lines 28-43): records one manager's renew/decline decision on their slot, audit log, `MANAGER_RENEWED`/`MANAGER_DECLINED` event — also inside one `$transaction`.

## The real finding: next-season creation does not exist

Grepping the entire `lib/`, `app/`, `server/` trees found **zero** write sites for `LeagueRenewal.nextSeasonId` (the FK field that would point at a newly created destination season — the column exists in the schema, `prisma/schema.prisma:15208`, but nothing ever sets it) and **zero** matches for `executeRenewal`, `completeRenewal`, `finalizeRenewal`, `createNextSeason`, or `createSeasonFromRenewal` anywhere in the repository.

`LeagueLifecycleAction` (`server/services/leagueLifecycleService.ts:39`) declares a `'renewal_execute'` action literal and lists it as valid from the `renewal_pending` state (`:173`) — but grepping the whole codebase shows it is never referenced by any route, gate call, or service. It is declared scaffolding for a step that was never built.

A separate, legacy route (`app/api/commissioner/leagues/[leagueId]/renew/route.ts`) contains what a real season-mutation implementation would have looked like — but it is dead code: its `POST` handler returns HTTP 410 `{"error":"This renewal endpoint is deprecated. Use /api/redraft/renewals."}` unconditionally at line 145, before ever reaching the season-mutation logic that follows it (lines 146-383 are unreachable). That unreachable code itself is not transactional (roughly 8 separate non-`$transaction` `prisma.league.update`/`updateMany` calls) and would not meet this program's atomicity bar even if it were reachable.

## Verdict

**NOT IMPLEMENTED.** Only the renewal-*proposal* lifecycle exists: opening a renewal window and collecting each manager's renew/decline decision. No code path anywhere creates a destination `RedraftSeason` row, copies league settings, scoring settings, draft configuration, schedule configuration, playoff configuration, or waiver configuration, creates roster shells, preserves manager-to-team ownership into a new season, or marks a `LeagueRenewal` as `completed`/sets its `nextSeasonId`.

This is not a transactionality bug to fix with a "smallest justified correction" — it is a missing feature. Per this phase's explicit guardrail ("do not redesign the redraft product... do not add speculative abstractions" and "implement only defects reproduced through physical execution, failing tests, or direct call-graph evidence" — evidence here shows an ABSENT capability, not a defect in an existing one), **no attempt was made to build atomic next-season creation this phase.** Building it (Part 5's full 19-step transaction plus its 18-scenario test matrix) is a substantial new feature implementation, correctly scoped as its own future phase, not a same-phase "hardening" fix. This is the single most significant finding of this entire phase and should be treated as the dominant remaining P0 blocker for Gate C and for renewal-dependent readiness generally.
