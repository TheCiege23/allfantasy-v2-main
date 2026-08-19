# Commissioner OS Context Contract

Date: 2026-07-13. Documents `CommissionerOsContext`
(`lib/shared-services/league-hub/commissionerOsContext.ts`) — the single
context object every commissioner domain generator reads from.

## Authorization boundary (Part 3)

`assembleCommissionerOsContext({ appUserId, canonicalLeagueId })` returns
`null` — fail-closed — unless `resolveActiveLeagueContext` resolves
`isCommissioner === true` for that exact `(appUserId, canonicalLeagueId)`
pair. Callers (the API route, the Chimmy seam) must treat `null` as
404/access-denied, never assume access.

`isCommissioner` is derived from any of:

1. **Native ownership** — `isOwner && provider === 'allfantasy'`.
2. **Team-level commissioner flag** — `LeagueTeam.isCommissioner` or
   `isCoCommissioner` (set by Sleeper's real bootstrap, `r.is_commissioner`).
3. **Recorded attestation/API verification** — `League.settings.
   commissionerVerification = { method: 'api' | 'attestation', appUserId }`,
   trusted only when `appUserId` matches the exact caller and `method` is
   `'api'` or `'attestation'` (never `'membership-only'`, which explicitly
   means no commissioner claim was made).

### The real gap this phase found and fixed

`ImportedLeagueCommitService.ts` (the shared MFL/ESPN/Yahoo/Fantrax commit
path) never sets `LeagueTeam.isCommissioner` at all — only the
Sleeper-specific bootstrap does. Before this phase's fix, a real MFL/ESPN/
Yahoo commissioner who provided a valid, recorded attestation still
resolved to `isCommissioner: false`. Path 3 above closes that gap by also
trusting the real, already-recorded `commissionerVerification` audit
record — scoped tightly (exact `appUserId` match, `api`/`attestation`
method only) so it never broadens to "any league member."

Real invariant this fix relies on, confirmed via
`lib/league-import/commissionerGate.ts::recordCommissionerVerificationMethod`:
the attesting `appUserId` is always the importer, and the importer is
always `League.userId` at league-creation time — so a real attested
commissioner also always satisfies the underlying membership gate (owner,
member, or claimed-team holder) that `resolveActiveLeagueContext` checks
before it ever evaluates attestation. This is *not* a redundant check —
Part 21's physical validation and the unit test suite (`__tests__/
commissioner-os/commissionerOsContext.test.ts`) both exercise it directly
against a real ESPN league fixture.

Rejected explicitly, with test coverage: normal league members (real
membership alone is not commissioner authority), cross-user strangers with
no relationship to the league, nonexistent leagues (identical `null` to
"not the commissioner" — never leaks whether a protected league exists),
`membership-only`-verified callers, and attestation records whose
`appUserId` doesn't match the caller (revoked/mismatched authority).

## The context object

| Field | Source | Notes |
|---|---|---|
| `provider`, `sport`, `season`, `isDynasty` | `League` row | Real, never invented |
| `isSnapshotOnly` | `deriveImportType(provider) === 'csv_snapshot'` | `true` only for Fantrax — see `COMMISSIONER_OS_CONTENT_POLICY.md` |
| `syncFreshness` | `deriveSyncFreshness()` (existing, unmodified) | Drives `isFreshnessSafeForPriority` gating in every generator |
| `shared` | `buildCommissionerContext()` (unmodified, real, pre-existing) | Mission Control + League Analytics + format-awareness federation |
| `health` | `buildLeagueHealthAssessment(shared)` | Never recomputed by this phase |
| `attentionItems` | `buildCommissionerAttentionItems(shared)` | Real `deriveLeagueAttentionSignals()` output |
| `ranking` | `buildCommissionerRanking(shared)`, caught to `null` on failure | Never throws through to the caller |
| `brief` | `buildCommissionerBrief(shared, ranking, attentionItems)` | Facts-only, no LLM-computed numbers |
| `championHistory` | Real `LeagueSeason` rows | Empty when no season history recorded — never fabricated |
| `rivalries` | Real `RivalryRecord` rows + real `_count.events` | See "the eventCount bug" below |
| `dramaEvents` | Real `DramaEvent` rows, current season, top 20 by score | Empty when the engine hasn't found anything this season |
| `draftGrades` | Real `DraftGrade` rows, current season | Empty when no draft has been graded |
| `unavailableDomains` | Computed honestly, see below | Never guessed a second time downstream |

### The `eventCount` bug found and fixed this phase

The original query fetched each rivalry's `events` relation with `take: 1`
(for `latestEvent`) and used `events.length` as the real event count —
which, capped at 1, could never legitimately resolve to `'complete'`
`sourceHistoryConfidence` even for a rivalry with a long real history.
Fixed by adding a separate `_count: { select: { events: true } }` to the
same query and reading `r._count.events` — the `latestEvent` query and the
real total count are now independent, both real. Covered by a dedicated
regression test.

### `unavailableDomains`

Computed once, here, and never re-derived by any generator:

- `storylines_weekly_cadence` — non-NFL sport (weekly-cadence storyline
  types don't map cleanly to daily-cadence sports without a real per-sport
  adapter, not built this phase).
- `rivalries_history` — zero `RivalryRecord` rows for this league (the
  rivalry engine has never detected a qualifying pairing).
- `draft_grades` — zero `DraftGrade` rows for the current season (no draft
  has been graded yet).

Note: `dramaEvents.length === 0` for an NFL league does **not** add a
storylines-unavailable marker — see `COMMISSIONER_OS_DOMAIN_SUPPORT_MATRIX.md`
for why this asymmetry with rivalries/draft is intentional, not an
oversight.
