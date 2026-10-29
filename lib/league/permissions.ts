import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { prisma } from '@/lib/prisma'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'
import {
  CO_COMMISSIONER_SCOPES,
  coCommissionerAllowed,
  missingScopeMessage,
  readCoCommissionerScopes,
  type CoCommissionerScope,
} from '@/lib/league/coCommissionerScopes'

const asScopes = (scope?: CoCommissionerScope | readonly CoCommissionerScope[]): CoCommissionerScope[] =>
  scope == null ? [] : typeof scope === 'string' ? [scope] : [...scope]

export type LeagueRole = 'commissioner' | 'co_commissioner' | 'member' | 'viewer' | null

/**
 * Returns the role of userId in leagueId.
 * Head commissioner is always the AllFantasy league owner (`League.userId`), regardless of imported Sleeper flags.
 * A co-commissioner granted by the tournament that created the league (see ./tournamentCoCommissioners)
 * is `co_commissioner` whether or not they hold a team in it.
 */
export async function getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, settings: true },
  })
  if (!league) return null
  if (league.userId === userId) return 'commissioner'
  const tournamentCoCommissioner = isTournamentCoCommissioner(league.settings, userId)

  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      claimedByUserId: userId,
    },
    select: {
      isCommissioner: true,
      isCoCommissioner: true,
      role: true,
    },
  })

  if (team) {
    if (team.role === 'viewer') return 'viewer'
    if (team.isCommissioner) return 'commissioner'
    if (team.isCoCommissioner || tournamentCoCommissioner) return 'co_commissioner'
    return 'member'
  }
  if (tournamentCoCommissioner) return 'co_commissioner'

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (roster) return 'member'

  return null
}

/**
 * Head commissioner or co-commissioner — the roles that run a league. The one rule behind
 * `requireCommissionerRole`, exported for callers that need a yes/no rather than a thrown 403
 * (a screen deciding what to show must agree with the route that will accept the write).
 */
export function isCommissionerRole(role: LeagueRole): role is 'commissioner' | 'co_commissioner' {
  return role === 'commissioner' || role === 'co_commissioner'
}

/**
 * Yes/no: may userId act as commissioner or co-commissioner of leagueId? The league owner, anyone
 * holding a team flagged `isCommissioner` / `isCoCommissioner`, or a co-commissioner granted by the
 * tournament that created the league (./tournamentCoCommissioners — no team needed).
 *
 * One read. It is the check the redraft commissioner routes each carried a private copy of, with the
 * tournament list added; unlike `getLeagueRole` it looks at EVERY team the user holds, as those
 * copies did, so moving them here narrows nobody. Co-commissioner rights only — no team, no seat.
 */
export async function hasLeagueCommissionerRights(
  leagueId: string,
  userId: string,
  scope?: CoCommissionerScope | readonly CoCommissionerScope[],
): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      settings: true,
      teams: { where: { claimedByUserId: userId }, select: { id: true, isCommissioner: true, isCoCommissioner: true } },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  const teams = (league.teams ?? []) as { id?: string; isCommissioner: boolean; isCoCommissioner: boolean }[]
  if (teams.some((t) => t.isCommissioner)) return true
  const coTeamIds = teams.filter((t) => t.isCoCommissioner).map((t) => String(t.id ?? ''))
  if (coTeamIds.length) {
    // A co-commissioner team: limited to what the head commissioner granted (./coCommissionerScopes).
    if (coCommissionerAllowed(league.settings, coTeamIds, asScopes(scope))) return true
    // ...but a tournament grant on top of a limited team still carries full rights.
    return isTournamentCoCommissioner(league.settings, userId)
  }
  return isTournamentCoCommissioner(league.settings, userId)
}

/**
 * The scopes a co-commissioner is missing for `required`, or [] when allowed. Only co-commissioner
 * TEAMS are limited: a tournament-granted co-commissioner (no team) holds every scope.
 */
async function missingCoCommissionerScopes(
  leagueId: string,
  userId: string,
  settings: unknown,
  required: readonly CoCommissionerScope[],
): Promise<CoCommissionerScope[]> {
  if (!required.length || isTournamentCoCommissioner(settings, userId)) return []
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId, claimedByUserId: userId, isCoCommissioner: true },
    select: { id: true },
  })
  const ids = teams.map((t) => t.id)
  if (!ids.length || coCommissionerAllowed(settings, ids, required)) return []
  const held = new Set(ids.flatMap((id) => readCoCommissionerScopes(settings, id)))
  return CO_COMMISSIONER_SCOPES.filter((s) => required.includes(s) && !held.has(s))
}

/**
 * Throws a 403 Response if userId is not commissioner or co-commissioner
 * of leagueId. Use this at the top of every settings API route.
 *
 * `scope` names the area the action belongs to (./coCommissionerScopes). A co-commissioner the head
 * commissioner limited is refused outside it; with no scope, any co-commissioner passes.
 */
export async function requireCommissionerRole(
  leagueId: string,
  userId: string,
  scope?: CoCommissionerScope | readonly CoCommissionerScope[],
): Promise<void> {
  const league = await prisma.league.findFirst({ where: { id: leagueId }, select: { settings: true } })
  if (seasonSetupBlocked(league?.settings)) throw new Response(JSON.stringify({ error: 'Tournament settings are frozen while setup is completed.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  const role = await getLeagueRole(leagueId, userId)
  if (!isCommissionerRole(role)) {
    throw new Response(
      JSON.stringify({ error: 'Only the commissioner can change league settings.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (role === 'co_commissioner') {
    const missing = await missingCoCommissionerScopes(leagueId, userId, league?.settings, asScopes(scope))
    if (missing.length) {
      throw new Response(
        JSON.stringify({ error: missingScopeMessage(missing), missingScopes: missing }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }
}

/**
 * Same as requireCommissionerRole but ONLY allows commissioner (not co-comm).
 * Use for destructive actions like Reset Draft and co-commissioner management.
 */
export async function requireCommissionerOnly(leagueId: string, userId: string): Promise<void> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner') {
    throw new Response(
      JSON.stringify({ error: 'Only the head commissioner can perform this action.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
