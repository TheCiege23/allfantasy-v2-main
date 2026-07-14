# NCAAF Physical Proof

## Fixture verification, not assumed

Per the explicit instruction to verify real schema/data before use, both candidate NCAAF fixtures were queried directly against the disposable production-fork branch before any test ran: `tc-ncaaf-league`/`tc-ncaaf-season` (real commissioner `tc-commish-user`, 5 real rosters all with real owners, NFL... sport correctly `NCAAF`, `season: 2026`, `totalWeeks: 17`, `playoffStartWeek: 15`) and `rwr-ncaaf-smoke-league`/`rwr-ncaaf-smoke-season` (1 real roster with owner, `totalWeeks: 15`, `playoffStartWeek: 13`). `tc-ncaaf-league` was selected for its richer roster count.

## Real proving run, via the actual route (not the service directly)

Minimal safe fixture changes applied directly (per the "minimum safe fixture changes" instruction — no player/scoring/schedule data was fabricated): `redraft_seasons.status = 'complete'` for `tc-ncaaf-season`; `leagues.lifecycleState = 'offseason'` for `tc-ncaaf-league` (a real precondition of the pre-existing `openRedraftRenewal`); a `LeagueSeason` snapshot row upserted for `(tc-ncaaf-league, league.season)` (another real, pre-existing precondition of `openRedraftRenewal`, unrelated to this phase's own code).

**Result, via `POST /api/redraft/renewals/[renewalId]/execute` (the real route handler, session mocked, Prisma real against the disposable database)**:

```
status: 201
{
  "sourceLeagueId": "tc-ncaaf-league",
  "sourceSeasonId": "tc-ncaaf-season",
  "destinationLeagueId": "tc-ncaaf-league",
  "requestedSeason": 2027,
  "status": "created",
  "rosterCount": 5,
  "managerAssignmentCount": 5,
  ...
}
```

Direct re-query confirmed: destination `RedraftSeason.sport === 'NCAAF'` (sport correctly preserved through the whole pipeline — no hidden NFL assumption silently overwrote it), `season === 2027` (source 2026 + 1, correct sequencing), 5 destination rosters created, every one with a real, preserved `ownerId` matching the source. Exact replay through the same route returned `200 already_created` with the identical `destinationSeasonId` — zero duplicate rows confirmed by direct count.

## Hidden-NFL-assumption inspection, explicit

- **Season numbering**: `createNextSeason`/`evaluateNextSeasonEligibility` use plain integer season arithmetic (`season + 1`) with no NFL-specific calendar logic — confirmed correct for NCAAF's real `2026 → 2027` sequencing.
- **Week assumptions**: `totalWeeks`/`playoffStartWeek` are copied verbatim from the source `RedraftSeason` row, not hardcoded — NCAAF's real `17`/`15` values (differing from a typical NFL league's values) were preserved into the destination without modification.
- **Playoff assumptions**: the eligibility check's `playoffBracketStatus` logic is bracket-existence-based, not sport-based — `tc-ncaaf-season` had no `RedraftPlayoffBracket` row (same as the NFL fixtures used), and was treated identically (passing, per the documented "no bracket = no requirement" judgment call).
- **Schedule assumptions**: schedule initialization is deferred for both sports identically — no NFL-specific schedule logic exists to diverge.
- **Roster assumptions**: roster-shell creation logic is sport-agnostic — confirmed by the real 5-for-5 correct roster/ownership carry-over.
- **Commissioner continuity**: `tc-commish-user` (the real NCAAF league's `userId`) was correctly recognized as authorized without any sport-specific authorization branch.

## Verdict

NCAAF is now genuinely, physically proven for the core happy path and exact-replay idempotency — not merely "code is sport-agnostic by construction" as the prior phase disclosed. Not tested for NCAAF specifically: unauthorized rejection (covered generically, not NCAAF-specifically), concurrency scenarios, failure injection (all were tested against NFL fixtures only — the underlying code is identical, but per this program's own standard of not claiming untested sport-specific proof, this is disclosed as NFL-only concurrency/failure evidence).
