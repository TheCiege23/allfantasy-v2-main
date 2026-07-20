/**
 * Universal League Hub — Active League Context resolver (Parts 2, 5, 8).
 *
 * Establishes the single canonical "active league" context every downstream
 * OS module (User OS, Commissioner OS, Trade OS, Waiver OS, Lineup OS,
 * Rankings, Chimmy) should read instead of independently re-deriving league
 * membership. This phase only builds the resolver + wiring — it does not
 * implement any of those consuming modules.
 *
 * `rosterId` resolution reuses the real, already-established claim
 * mechanism: `lib/league-import/placeholderClaim.ts` rewrites
 * `Roster.platformUserId` to the claiming `AppUser.id` at claim time (see
 * `sourceManagerIdFromPlatformField` / the `data: { platformUserId:
 * candidate.appUserId }` writes there). So a claimed roster's
 * `platformUserId` *is* the real `AppUser.id` — this resolver queries on
 * that directly rather than re-deriving identity through `LeagueTeam.externalId`.
 *
 * Commissioner OS phase — `isCommissioner` also trusts a real, recorded
 * `League.settings.commissionerVerification` record (method `'api'` or
 * `'attestation'`, `appUserId` matching this exact caller) — see the fix
 * comment inline below for the real gap this closes.
 */
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { deriveSyncFreshness } from './syncFreshness'
import type { ActiveLeagueContext, LeagueHubProvider } from './types'

function toProvider(platform: string | null | undefined): LeagueHubProvider {
  const p = String(platform ?? '').toLowerCase()
  if (p === '' || p === 'allfantasy' || p === 'af' || p === 'manual' || p === 'native') return 'allfantasy'
  return p
}

/**
 * Resolves the active league context for a given (leagueId, userId) pair.
 * Returns `null` when the league doesn't exist or the user has no real
 * relationship to it (not owner, not a redraft member, no claimed team) —
 * callers (API routes) must treat `null` as 404/403, never assume access.
 */
export async function resolveActiveLeagueContext(args: {
  leagueId: string
  userId: string
}): Promise<ActiveLeagueContext | null> {
  const { leagueId, userId } = args

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      platform: true,
      sport: true,
      season: true,
      scoring: true,
      syncStatus: true,
      lastSyncedAt: true,
      settings: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { id: true, isCommissioner: true, isCoCommissioner: true },
      },
    },
  })
  if (!league) return null

  const isOwner = league.userId === userId
  const myTeam = league.teams[0] ?? null

  // The access decision delegates to the ONE canonical membership predicate in
  // `lib/league-access.ts`, so this resolver cannot drift from it. That union also
  // covers `Roster.platformUserId`, which this resolver's own owner/redraft/claimed-team
  // reads miss entirely: an imported (e.g. Sleeper) manager who claimed their placeholder
  // roster is represented ONLY by that column, and was previously 403'd here.
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) {
    return null
  }

  const provider = toProvider(league.platform)

  let verificationMethod: 'api' | 'attestation' | 'membership-only' | null = null
  let verifiedAppUserId: string | null = null
  const settings = league.settings
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const raw = (settings as Record<string, unknown>)['commissionerVerification']
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>
      const method = record['method']
      if (method === 'api' || method === 'attestation' || method === 'membership-only') {
        verificationMethod = method
      }
      if (typeof record['appUserId'] === 'string') {
        verifiedAppUserId = record['appUserId']
      }
    }
  }

  // Commissioner OS phase — real, previously-undiscovered gap: `ImportedLeagueCommitService.ts`
  // (the shared MFL/ESPN/Yahoo/Fantrax commit path) never sets `LeagueTeam.isCommissioner` at
  // all — only the Sleeper-specific bootstrap does (`r.is_commissioner`). Before this fix, a real
  // MFL/ESPN/Yahoo commissioner who provided a valid, recorded attestation still resolved to
  // `isCommissioner: false` here. Fixed by also trusting the real, already-recorded
  // `commissionerVerification` audit record — but ONLY when its `appUserId` matches THIS caller
  // and the method is `'api'` or `'attestation'` (never `'membership-only'`, which explicitly
  // means no commissioner claim was made) — never broadened to "any league member."
  const verifiedAsCommissioner =
    verifiedAppUserId === userId && (verificationMethod === 'api' || verificationMethod === 'attestation')

  const isCommissioner =
    Boolean(myTeam?.isCommissioner || myTeam?.isCoCommissioner) ||
    (isOwner && provider === 'allfantasy') ||
    verifiedAsCommissioner

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId: league.id, platformUserId: userId },
      select: { id: true },
    })
    .catch(() => null)

  return {
    canonicalLeagueId: league.id,
    provider,
    sport: String(league.sport ?? 'NFL'),
    season: league.season ?? null,
    teamId: myTeam?.id ?? null,
    rosterId: roster?.id ?? null,
    isCommissioner,
    commissionerVerificationMethod: verificationMethod,
    syncFreshness: deriveSyncFreshness({
      provider,
      syncStatus: league.syncStatus,
      lastSyncedAt: league.lastSyncedAt,
    }),
    scoring: league.scoring ?? null,
  }
}

/**
 * Chimmy discoverability alias (Part 8) — identical to `resolveActiveLeagueContext`.
 * Chimmy's own context-provider layer
 * (`lib/chimmy-context/providers/*ContextProvider.ts`, orchestrated by
 * `lib/chimmy-context/ChimmyContextEngine.ts`) can call this directly once a
 * future phase wires it in. This phase does not add a new
 * `ChimmyContextProvider`, does not modify `ChimmyContextEngine.ts`, and
 * does not touch any existing provider — per explicit instruction not to
 * rewrite Chimmy yet, only to expose a shared API it can consume later.
 */
export const getChimmyLeagueContext = resolveActiveLeagueContext
