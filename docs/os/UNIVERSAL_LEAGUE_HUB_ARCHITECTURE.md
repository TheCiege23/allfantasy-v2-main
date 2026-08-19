# Universal League Hub — Architecture (Foundation Phase)

Date: 2026-07-12. Follows directly from the Import Security Closure phase
(`docs/redraft/IMPORT_AUTHORIZATION_CONTRACT.md`) — this phase deliberately
did not start the Rankings rewrite (the previously-planned next step)
because that phase's own finding — MFL/ESPN/Yahoo full-league commit now
correctly requires an attestation UI that doesn't exist — made the
authorization layer the wrong thing to build on top of yet for a
data-migration project. The Universal League Hub is additive, read-only,
and requires no new authorization surface, so it was the safer, higher-leverage
next step: a real home screen for every already-imported league, built on
top of the now-secured canonical import layer instead of ahead of it.

## Scope of this phase

A foundation, not a finished home screen. Real, wired, physically compiling
and serving backend services + API routes + a real (if minimal) reference
UI — not a mockup. Explicitly **not** in scope: implementing any actual
recommendation (lineup/waiver/trade/roster/commissioner), rewriting Chimmy,
replacing the live Dashboard's cards, or a premium visual redesign. Those
are named, sequenced next steps (see the closing report).

## What was built

```
lib/shared-services/league-hub/
  types.ts                    canonical shapes (LeagueHubEntry, ActiveLeagueContext, ...)
  recommendationContract.ts   Part 4 — empty-bundle contract, 5 domains
  providerCapabilities.ts     Part 6 — truthful badge derivation
  syncFreshness.ts            Part 7 — truthful sync-state derivation
  LeaguePortfolioService.ts   Part 1 — getLeaguePortfolioForUser(userId)
  activeLeagueContext.ts      Parts 2/5/8 — resolveActiveLeagueContext(), getChimmyLeagueContext alias

app/api/league-hub/
  portfolio/route.ts                  GET — real session, calls the Portfolio service
  context/[leagueId]/route.ts         GET — real session + real membership check, 404 on no access

components/league-hub/
  ActiveLeagueContextProvider.tsx     React context — the one shared "active league" state
  LeagueSelector.tsx                  fetches the portfolio, renders the card grid
  UniversalLeagueCard.tsx             Part 3 — the canonical, provider-agnostic card

app/league-hub/
  page.tsx / LeagueHubClient.tsx      real, authenticated reference page mounting all of the above
```

## Why the Portfolio service wraps `getDashboardLeagueListForUser` instead of re-querying

Fresh-read of `lib/dashboard/get-dashboard-league-list.ts` (Part-1 audit,
this phase) found it already does the hard part correctly: it merges
`prisma.league` (native + every committed import — Sleeper/ESPN/Yahoo/MFL/
Fantrax all land here once imported) with the legacy `SleeperLeague` table
(pre-canonical-commit Sleeper rows, deduped via `hasUnifiedRecord`) and the
tournament-hub pseudo-league union. Re-deriving that merge/dedup logic in a
second place would violate this program's own repeated guardrail against
duplicating provider-specific logic — and would risk drifting from the
Dashboard's real, live-tested behavior. `getLeaguePortfolioForUser` calls
it, then adds exactly what it doesn't already carry:

- The viewer's own `LeagueTeam` record (wins/losses/ties/`currentRank`) —
  one batched `leagueTeam.findMany` keyed by the canonical league ids.
- A cached playoff-probability, read from the most recent
  `SeasonForecastSnapshot.teamForecasts` JSON blob for the league, matched
  by the viewer's own `LeagueTeam.id` — never a live simulation call on
  read (that engine is expensive; this is a real, existing cache, read
  honestly, returning `null` when no snapshot exists rather than compute one).
- Truthful provider capability badges and sync freshness (see the two
  dedicated docs below).
- An always-empty recommendation bundle (Part 4 contract).

## Canonical league id vs. legacy id (`hasCanonicalRecord`)

Not every row `getDashboardLeagueListForUser` returns has a real `League.id`
— a Sleeper league that was fetched but never committed into the canonical
`League` table (`hasUnifiedRecord: false`) only has a legacy
`SleeperLeague.id`. `LeagueHubEntry.hasCanonicalRecord` is `false` for those
rows; `LeaguePortfolioService` skips the `LeagueTeam`/forecast lookups for
them entirely (there is nothing canonical to join against) rather than
silently returning wrong data. No downstream OS module (Trade/Waiver/
Lineup) can resolve a legacy `SleeperLeague.id` — this flag is the honest
signal for "this league needs to be imported/committed before it can join
the rest of the OS," not a bug.

## Active League Context — real identity resolution, not string matching

`resolveActiveLeagueContext({ leagueId, userId })` resolves `rosterId` by
querying `Roster` where `platformUserId === userId` directly — this
reuses a real, already-established mechanism from `lib/league-import/placeholderClaim.ts`:
claiming a roster **rewrites** `Roster.platformUserId` to the claiming
`AppUser.id` (see the `data: { platformUserId: candidate.appUserId }`
writes there). A claimed roster's `platformUserId` *is* the real
`AppUser.id` — this resolver does not need to go through
`LeagueTeam.externalId` matching, a real gotcha this program's own prior
phases flagged (`Roster.id ≠ provider source_team_id`).

Access is fail-closed: `resolveActiveLeagueContext` returns `null` unless
the caller is the league owner, a real redraft member, or has a claimed
team — the API route maps `null` to 404, never assumes access from a
league id alone.

## League Tycoon seam

Grepped the full repository — zero implementation exists anywhere (no
route, no model, no component; not even a name reference outside this
prompt). Documented, not built around: when it exists, add one more source
array to the `Promise.all` inside `LeaguePortfolioService` (or, more likely,
inside `getDashboardLeagueListForUser` itself, matching this phase's own
reuse principle), normalize with `provider: 'allfantasy'` and
`importType: 'native'` — no other change needed anywhere downstream, since
every consumer already reads the canonical `LeagueHubEntry` shape.

## Deliberately deferred: swapping the live Dashboard's cards

Part 1's own audit (this phase) found the existing Dashboard cards
(`app/dashboard/components/LeagueHubCard.tsx`,
`.../warroom/MyLeagueCard.tsx`) were **already provider-agnostic** — keyed
off a shared `UserLeague` type, not duplicated per provider. There was no
actual per-provider duplication to "replace." `UniversalLeagueCard.tsx` is
the new canonical reference implementation, built and real, but swapping it
into the live, heavily-used Dashboard surface in the same phase that also
built it would be a real regression risk with no corresponding safety
benefit — identical reasoning to this program's own Rankings-rewrite
deferral. See the completion report for the recommended follow-up scope.
