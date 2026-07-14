# League Context Contract (Parts 2, 5, 8)

Date: 2026-07-12. Defines the one shared "active league" context every
downstream OS module (User OS, Commissioner OS, Trade OS, Waiver OS,
Lineup OS, Rankings, Chimmy) should read from — this phase establishes the
contract and its real backing resolver; it implements none of those
consuming modules.

## The shape (`lib/shared-services/league-hub/types.ts`)

```ts
interface ActiveLeagueContext {
  canonicalLeagueId: string
  provider: LeagueHubProvider
  sport: string
  season: number | string | null
  teamId: string | null        // LeagueTeam.id, or null if unclaimed
  rosterId: string | null      // Roster.id, or null if no canonical roster row
  isCommissioner: boolean
  commissionerVerificationMethod: 'api' | 'attestation' | 'membership-only' | null
  syncFreshness: SyncFreshness
  scoring: string | null       // real League.scoring string, e.g. "PPR"
}
```

Every field is either a real database column, a real derived value (see
`syncFreshness.ts`/`providerCapabilities.ts`), or an honest `null` — nothing
here is invented to fill a gap.

## How it's established (never re-authenticates)

1. **Selection is optimistic.** `LeagueSelector` already has the caller's
   own real `LeagueHubEntry` (from the Portfolio fetch, which already ran
   under the real session). `selectLeague(entry)` sets an immediate,
   already-real context from that entry's own fields (`provider`, `sport`,
   `season`, `teamId`, `isCommissioner`, `syncFreshness`) — no network round
   trip, no re-auth, before the full context is loaded.
2. **Hydration confirms/completes it.** The same call fires
   `GET /api/league-hub/context/[leagueId]`, which reuses the existing
   session cookie (no new login flow) and returns the fields the portfolio
   entry doesn't carry: `rosterId`, the real `scoring` string, and a
   server-refreshed `syncFreshness`.
3. **Persistence.** The selected league id is written to
   `sessionStorage` (`af.leagueHub.activeLeagueId`) so a reload restores the
   same context without asking the user to re-select — still no re-auth,
   since the session cookie itself is what actually authorizes the
   subsequent hydration fetch.

## Server-side resolver: `resolveActiveLeagueContext`

`lib/shared-services/league-hub/activeLeagueContext.ts`. Fail-closed by
design: returns `null` unless the caller is the real league owner
(`League.userId`), a real redraft member (`RedraftMember` row), or has a
real claimed team (`LeagueTeam.claimedByUserId`). The API route
(`app/api/league-hub/context/[leagueId]/route.ts`) maps `null` to 404 —
callers must never treat a league id alone as proof of access.

`rosterId` resolution reuses a real, already-established mechanism instead
of re-deriving identity: `lib/league-import/placeholderClaim.ts` rewrites
`Roster.platformUserId` to the claiming `AppUser.id` at claim time. A
claimed roster's `platformUserId` **is** the real `AppUser.id`, so this
resolver queries `Roster.findFirst({ where: { leagueId, platformUserId: userId } })`
directly — no `LeagueTeam.externalId` matching needed, and no re-introduction
of the `Roster.id ≠ provider source_team_id` gotcha this program's Trade
Shadow Backtest phase already flagged.

## Chimmy seam (Part 8) — exposed, not wired

`getChimmyLeagueContext` is a literal alias for `resolveActiveLeagueContext`,
exported specifically so Chimmy's own context-provider layer
(`lib/chimmy-context/providers/*ContextProvider.ts`, orchestrated by
`lib/chimmy-context/ChimmyContextEngine.ts`) can call it directly in a
future phase. This phase does **not** add a new `ChimmyContextProvider`
class, does not modify `ChimmyContextEngine.ts`, and does not touch any
existing provider — per the explicit instruction not to rewrite Chimmy yet,
only to expose a shared API it can consume later.

## What this contract deliberately does not cover yet

- Scoring settings beyond the raw `scoring` string (e.g. full point-value
  breakdowns) — not surfaced by any existing canonical field this phase
  found; a future phase should confirm whether `League.settings` carries
  enough real detail before adding it here.
- Multi-league "compare" context (holding two leagues active
  simultaneously) — out of scope; the contract is single-active-league by
  design, matching every consuming OS module named in this phase's brief.
