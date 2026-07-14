# Next-Season API Call Graph

## Route selection: extended the existing canonical renewal resource, not a competing route

Audited existing routes: `POST /api/redraft/renewals` (`openRedraftRenewal`), `POST /api/redraft/renewals/[renewalId]/decision` (`decideRedraftRenewal`) — both follow the same convention (`getServerSession(authOptions)`, body validation, service call, error-message-to-status mapping). The new route, `POST /api/redraft/renewals/[renewalId]/execute`, extends this same resource family rather than introducing a parallel top-level route, per the explicit guardrail.

## Real call graph

```
Commissioner action (execute a renewal already opened via POST /api/redraft/renewals)
  → POST /api/redraft/renewals/[renewalId]/execute
    → getServerSession(authOptions)                         [authentication]
    → body.idempotencyKey validation                          [input validation]
    → prisma.leagueRenewal.findUnique(renewalId)               [resolve renewal → sourceLeagueId/sourceSeasonId/requestedSeason]
    → prisma.league.findUnique + real commissioner-membership check   [server-derived authorization]
    → if renewal.nextSeasonId already set: return stable 200 (already_created), no further writes
    → createNextSeasonWithConflictHandling(...)
        → createNextSeason(...)                                [the atomic transaction, unchanged from the prior phase]
        → on verified Postgres serialization conflict: one bounded retry
        → if the retry also conflicts: RETRYABLE_CONFLICT (409)
    → map result.status → HTTP status (created→201, already_created→200, blocked→422, conflict→409)
    → structured server-side logging on internal error, no raw error to client
```

## Real, evidence-based discoveries during this audit

`openRedraftRenewal` (the existing, pre-existing open step) already populates `LeagueRenewal.priorSeasonId` (the source season) at open time — confirmed by direct read of `CanonicalRedraftRenewalService.ts:17`. This meant the new route did **not** need to accept `sourceLeagueId`/`sourceSeasonId` from the client at all (a stricter security posture than the brief's literal contract, which still listed them as client-supplied fields) — derived entirely server-side from the renewal row.

**A real semantic mismatch was found via physical testing, not audit alone**: `LeagueRenewal.season` (set from `League.season` at open time) represents the season being closed out — it equals the SOURCE `RedraftSeason.season`, not the destination. The route originally derived `requestedSeason: renewal.season` directly, which is wrong; fixed to `requestedSeason: renewal.season + 1`. This was only caught because the physical NFL/NCAAF proving runs (Part 7/13) returned real `422 INVALID_SEASON_SEQUENCE` responses before the fix — a static audit of the two services' contracts in isolation would not have surfaced this, since each side's own field naming is internally consistent; the mismatch only exists at their integration seam.
