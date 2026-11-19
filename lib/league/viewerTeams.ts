/**
 * Which team is this manager acting as?
 *
 * Almost everything a manager does (set a lineup, claim a player, propose a trade, make a pick) starts
 * by finding "my team" from the league and the signed-in user. That was a single lookup because a
 * manager could only ever hold one team in a league. A league can now allow a manager to run several
 * (lib/league/multiTeamManagers.ts), and "the first one found" would then put a lineup change or a
 * waiver claim on the wrong team with nothing to show for it.
 *
 * So the rule lives here, once:
 *   - one team held: that team, exactly as before;
 *   - several held and the request names one of them: that team;
 *   - several held and the request names none: REFUSED (`TEAM_REQUIRED`). Never a guess.
 *   - a team named that the manager does not hold: REFUSED (`NOT_YOUR_TEAM`).
 * With nothing named, the team the manager last switched to (a cookie, see below) is used when they hold it.
 *
 * `chooseActingTeam` is the pure rule; `resolveActingRoster` reads the manager's teams and applies it.
 */
import { rosterSourceTeamId } from '@/lib/league-import/importedRosterIdentity'
import { managedRosterWhere } from '@/lib/league/rosterManager'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'

export type HeldTeam = { rosterId: string; redraftRosterId: string | null }

export type ActingTeam =
  | { ok: true; rosterId: string; redraftRosterId: string | null; heldCount: number; viaCoOwner: boolean }
  | { ok: false; code: 'NO_TEAM' | 'TEAM_REQUIRED' | 'NOT_YOUR_TEAM'; status: number; message: string; rosterIds: string[] }

/** Native franchises use their roster ID. Imported franchises keep their provider's team ID. */
export async function leagueTeamsForRosters<T extends { externalId: string }>(
  leagueId: string, rosterIds: readonly string[], teams: readonly T[],
): Promise<Map<string, T>> {
  const byExternalId = new Map(teams.map(team => [team.externalId, team]))
  const mapped = new Map<string, T>()
  const missing: string[] = []
  for (const id of rosterIds) {
    const team = byExternalId.get(id)
    if (team) mapped.set(id, team)
    else missing.push(id)
  }
  if (missing.length) {
    const imported = await prisma.roster.findMany({
      where: { leagueId, id: { in: missing } }, select: { id: true, playerData: true },
    })
    for (const roster of imported) {
      const sourceId = rosterSourceTeamId(roster.playerData)
      const team = sourceId ? byExternalId.get(sourceId) : undefined
      if (team) mapped.set(roster.id, team)
    }
  }
  return mapped
}

/** The header and the query/body field a request names its team with. */
export const ACTING_TEAM_HEADER = 'x-af-roster-id'
export const ACTING_TEAM_FIELD = 'rosterId'

/**
 * The manager's ACTIVE team: the one they switched to in the league header, remembered in a cookie so
 * every request carries it without each screen having to. It is a preference, not a claim: a remembered
 * team the manager no longer holds is ignored, where a team NAMED on the request and not held is refused.
 * The cookie lists one roster id per league, dot-separated; ids are unique across leagues.
 */
export const ACTIVE_TEAMS_COOKIE = 'af_active_teams'
const ACTIVE_TEAMS_MAX = 40
const PREFERRED_PREFIX = 'preferred:'

function readActiveTeamIds(cookieValue: string | null | undefined): string[] {
  return String(cookieValue ?? '')
    .split('.')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{6,64}$/.test(id))
    .slice(0, ACTIVE_TEAMS_MAX)
}

/**
 * The teams this request's manager last switched to, read from the request in flight. For server code
 * that is not handed the request (the draft helpers). Empty outside a request.
 */
export async function rememberedActiveTeamIds(): Promise<string[]> {
  try {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    return readActiveTeamIds(store.get(ACTIVE_TEAMS_COOKIE)?.value)
  } catch {
    return []
  }
}

/** The cookie value after switching to `rosterId`, dropping the league's other teams from the list. */
export function activeTeamsCookieAfterSwitch(current: string | null | undefined, rosterId: string, leagueRosterIds: readonly string[]): string {
  const others = new Set(leagueRosterIds)
  return [rosterId, ...readActiveTeamIds(current).filter((id) => id !== rosterId && !others.has(id))].slice(0, ACTIVE_TEAMS_MAX).join('.')
}

export function chooseActingTeam(held: readonly HeldTeam[], requestedRosterId: string | null | undefined): ActingTeam {
  const rosterIds = held.map((team) => team.rosterId)
  const raw = typeof requestedRosterId === 'string' ? requestedRosterId.trim() : ''
  // Remembered teams only ever pick among the teams held; with no match they count as nothing named.
  const preferred = raw.startsWith(PREFERRED_PREFIX)
    ? raw.slice(PREFERRED_PREFIX.length).split('.').find((id) => held.some((team) => team.rosterId === id)) ?? ''
    : null
  const requested = preferred ?? raw
  if (held.length === 0) {
    return { ok: false, code: 'NO_TEAM', status: 404, message: 'You do not have a team in this league.', rosterIds }
  }
  if (requested) {
    const team = held.find((candidate) => candidate.rosterId === requested || candidate.redraftRosterId === requested)
    if (!team) {
      return { ok: false, code: 'NOT_YOUR_TEAM', status: 403, message: 'That team is not yours.', rosterIds }
    }
    return { ok: true, rosterId: team.rosterId, redraftRosterId: team.redraftRosterId, heldCount: held.length, viaCoOwner: false }
  }
  if (held.length > 1) {
    return {
      ok: false,
      code: 'TEAM_REQUIRED',
      status: 409,
      message: 'You run more than one team in this league. Choose which team this is for.',
      rosterIds,
    }
  }
  const only = held[0]!
  return { ok: true, rosterId: only.rosterId, redraftRosterId: only.redraftRosterId, heldCount: 1, viaCoOwner: false }
}

/** Every team this manager holds in the league, in a stable order. */
export async function listHeldTeams(leagueId: string, userId: string): Promise<HeldTeam[]> {
  if (!leagueId || !userId) return []
  // Their first team (keyed by their user id) and any further team that names them as its manager.
  const select = { id: true, redraftRosterId: true } as const
  const delegate = prisma.roster as typeof prisma.roster & { findMany?: typeof prisma.roster.findMany }
  const many = typeof delegate.findMany === 'function'
    ? await delegate.findMany({ where: managedRosterWhere(leagueId, userId), select, orderBy: { id: 'asc' } })
    : null
  const where = { leagueId, platformUserId: userId }
  /*
   * A database client that answers only the single-team read (the many unit-test doubles written when a
   * manager could hold one team) is asked that way, so those suites keep exercising these routes. The
   * real client always answers the list read above.
   */
  const rosters = Array.isArray(many) ? many : [await prisma.roster.findFirst({ where, select })].filter((r): r is NonNullable<typeof r> => Boolean(r))
  return rosters.map((roster) => ({ rosterId: roster.id, redraftRosterId: roster.redraftRosterId ?? null }))
}

/** The team a request names: the header first, then `?rosterId=`, then a `rosterId` in the body. */
export function requestedRosterIdFrom(
  req: { headers?: { get(name: string): string | null } | null; nextUrl?: { searchParams?: URLSearchParams | null } | null } | null | undefined,
  body?: unknown,
): string | null {
  const fromHeader = req?.headers?.get?.(ACTING_TEAM_HEADER)?.trim()
  if (fromHeader) return fromHeader
  const fromQuery = req?.nextUrl?.searchParams?.get?.(ACTING_TEAM_FIELD)?.trim()
  if (fromQuery) return fromQuery
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>)[ACTING_TEAM_FIELD]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  // Nothing named: fall back to the team the manager last switched to, as a preference.
  const cookies = (req as { cookies?: { get?(name: string): { value?: string } | undefined } } | null | undefined)?.cookies
  const remembered = readActiveTeamIds(cookies?.get?.(ACTIVE_TEAMS_COOKIE)?.value)
  return remembered.length > 0 ? `${PREFERRED_PREFIX}${remembered.join('.')}` : null
}

/**
 * The team this manager is acting as. A manager with no team of their own may still be an accepted
 * co-owner of one (lib/team-coowners/access.ts), which is used when nothing else is held.
 */
export async function resolveActingRoster(
  leagueId: string,
  userId: string,
  requestedRosterId?: string | null,
  opts: { allowCoOwner?: boolean } = {},
): Promise<ActingTeam> {
  const held = await listHeldTeams(leagueId, userId)
  // Nothing named by the caller: with several teams, fall back to the team the manager last switched to,
  // read from the request in flight. Code that was never handed the request gets the same answer as a route.
  if (held.length > 1 && !(typeof requestedRosterId === 'string' && requestedRosterId.trim())) {
    const remembered = await rememberedActiveTeamIds()
    if (remembered.length > 0) requestedRosterId = `${PREFERRED_PREFIX}${remembered.join('.')}`
  }
  if (held.length === 0 && opts.allowCoOwner !== false) {
    const coOwned = await acceptedCoOwnerRosterId(leagueId, userId)
    if (coOwned) {
      const requested = typeof requestedRosterId === 'string' ? requestedRosterId.trim() : ''
      if (requested && !requested.startsWith(PREFERRED_PREFIX) && requested !== coOwned) {
        return { ok: false, code: 'NOT_YOUR_TEAM', status: 403, message: 'That team is not yours.', rosterIds: [coOwned] }
      }
      const roster = await prisma.roster.findFirst({ where: { id: coOwned, leagueId }, select: { redraftRosterId: true } })
      return { ok: true, rosterId: coOwned, redraftRosterId: roster?.redraftRosterId ?? null, heldCount: 1, viaCoOwner: true }
    }
  }
  return chooseActingTeam(held, requestedRosterId)
}

/**
 * The team a READ shows: the named team when the manager holds it, otherwise their first team (a stable
 * order), or null with no team. Screens and summaries may fall back like this; anything that CHANGES a
 * team must use `resolveActingRoster`, which refuses instead.
 */
export async function resolveViewingRoster(
  leagueId: string,
  userId: string,
  requestedRosterId?: string | null,
  opts: { allowCoOwner?: boolean } = {},
): Promise<{ rosterId: string; redraftRosterId: string | null; heldCount: number } | null> {
  const acting = await resolveActingRoster(leagueId, userId, requestedRosterId, opts)
  if (acting.ok) return { rosterId: acting.rosterId, redraftRosterId: acting.redraftRosterId, heldCount: acting.heldCount }
  if (acting.code === 'NO_TEAM') return null
  // Several teams and none (or a wrong one) named: show the first rather than nothing.
  const held = await listHeldTeams(leagueId, userId)
  const first = held[0]
  return first ? { rosterId: first.rosterId, redraftRosterId: first.redraftRosterId, heldCount: held.length } : null
}

/**
 * The `where` for the team this user is looking at in a league: the co-owned team when they act as a
 * co-owner, else the team named or last switched to, else their first. With no team it is the plain
 * owner-key filter, which finds nothing, so callers keep their own "no team" handling.
 */
export async function viewingRosterWhere(
  leagueId: string,
  userId: string,
  coOwnerRosterId?: string | null,
): Promise<{ leagueId: string; id: string } | { leagueId: string; platformUserId: string }> {
  if (coOwnerRosterId) return { leagueId, id: coOwnerRosterId }
  const viewing = await resolveViewingRoster(leagueId, userId).catch(() => null)
  return viewing ? { leagueId, id: viewing.rosterId } : { leagueId, platformUserId: userId }
}

/** Thrown by a lookup helper that cannot return a response itself; the route turns it into one. */
export class ActingTeamRefused extends Error {
  constructor(public readonly result: Extract<ActingTeam, { ok: false }>) {
    super(result.message)
    this.name = 'ActingTeamRefused'
  }
}

/** The refusal as a response: the code, and the teams to choose from when one must be named. */
export function actingTeamRefusal(result: Extract<ActingTeam, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: result.message, code: result.code, ...(result.code === 'TEAM_REQUIRED' ? { rosterIds: result.rosterIds } : {}) },
    { status: result.status },
  )
}
