/**
 * Who may take a commissioner action in a league — the one rule (2026-11-16).
 *
 *   'head'                 the head commissioner only: the league owner, or a claimed team flagged `isCommissioner`.
 *                          For actions a head commissioner cannot delegate: managing co-commissioners, transferring
 *                          the league, deleting it, wiping the draft, or removing a commissioner's seat.
 *   a co-commissioner scope (scoring, rosters, trades, money, chat, league — ./coCommissionerScopes)
 *                          the head commissioner always; a co-commissioner only when the head commissioner granted
 *                          that area (a co-commissioner nobody configured holds every area; an empty list is view
 *                          only). A co-commissioner granted by the tournament that created the league holds every area.
 *
 * 🛑 WHY THIS EXISTS. A census of the commissioner routes (2026-11-16) found ~290 write handlers using five different
 * checks: ~183 let only the owner or head through, so a co-commissioner the head commissioner had given scoring was
 * still refused by the scoring screen; ~105 let ANY co-commissioner through, so a co-commissioner limited to chat could
 * change the schedule or release the head commissioner's seat. Only ~40 honoured the grant. A commissioner who hands
 * part of the job to someone could not trust either direction. Routes call this instead of their own check.
 *
 * It reads every team the user holds (a user with a co-commissioner team and a member team is a co-commissioner), and
 * a team whose role is `viewer` grants nothing — the same rules as `hasLeagueCommissionerRights` and
 * `hasClaimedCommissionerTeam`, which it agrees with for every input.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'
import {
  CO_COMMISSIONER_SCOPES,
  missingScopeMessage,
  readCoCommissionerScopes,
  type CoCommissionerScope,
} from '@/lib/league/coCommissionerScopes'

/**
 * `view` — any commissioner, whatever they were granted: reading a commissioner screen. A co-commissioner with an
 * empty grant is view-only, and this is the view.
 */
export type CommissionerNeed = CoCommissionerScope | 'head' | 'view'

export type CommissionerAccess =
  | { ok: true; role: 'head' | 'co_commissioner'; scopes: CoCommissionerScope[] }
  | { ok: false; status: 403 | 404; error: string; missingScopes?: CoCommissionerScope[] }

export const HEAD_ONLY_MESSAGE = 'Only the head commissioner can do this.'
export const NOT_COMMISSIONER_MESSAGE = 'Only the commissioner can do this.'

type TeamRow = { id: string; isCommissioner: boolean; isCoCommissioner: boolean; role: string | null }

/** The viewer's standing in a league: head, a co-commissioner with these scopes, or neither. */
export async function readCommissionerStanding(
  leagueId: string,
  userId: string | null | undefined,
): Promise<{ found: boolean; role: 'head' | 'co_commissioner' | null; scopes: CoCommissionerScope[]; settings: unknown }> {
  if (!userId) return { found: true, role: null, scopes: [], settings: null }
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      settings: true,
      teams: { where: { claimedByUserId: userId }, select: { id: true, isCommissioner: true, isCoCommissioner: true, role: true } },
    },
  })
  if (!league) return { found: false, role: null, scopes: [], settings: null }
  const all = [...CO_COMMISSIONER_SCOPES]
  if (league.userId === userId) return { found: true, role: 'head', scopes: all, settings: league.settings }
  const teams = ((league.teams ?? []) as TeamRow[]).filter((t) => t.role !== 'viewer')
  if (teams.some((t) => t.isCommissioner === true)) return { found: true, role: 'head', scopes: all, settings: league.settings }
  if (isTournamentCoCommissioner(league.settings, userId)) return { found: true, role: 'co_commissioner', scopes: all, settings: league.settings }
  const coIds = teams.filter((t) => t.isCoCommissioner === true).map((t) => t.id)
  if (!coIds.length) return { found: true, role: null, scopes: [], settings: league.settings }
  const held = new Set(coIds.flatMap((id) => readCoCommissionerScopes(league.settings, id)))
  return { found: true, role: 'co_commissioner', scopes: CO_COMMISSIONER_SCOPES.filter((s) => held.has(s)), settings: league.settings }
}

/**
 * May this user take an action that needs `need`? A result, never a throw. A list of areas (a settings save that
 * touches several) needs every one of them; an empty list is a view.
 */
export async function commissionerAccess(
  leagueId: string,
  userId: string | null | undefined,
  need: CommissionerNeed | readonly CoCommissionerScope[],
): Promise<CommissionerAccess> {
  const standing = await readCommissionerStanding(leagueId, userId)
  if (!standing.found) return { ok: false, status: 404, error: 'League not found' }
  if (standing.role === 'head') return { ok: true, role: 'head', scopes: standing.scopes }
  if (standing.role !== 'co_commissioner') return { ok: false, status: 403, error: NOT_COMMISSIONER_MESSAGE }
  if (need === 'head') return { ok: false, status: 403, error: HEAD_ONLY_MESSAGE }
  if (need === 'view') return { ok: true, role: 'co_commissioner', scopes: standing.scopes }
  if (typeof need !== 'string') {
    const missing = CO_COMMISSIONER_SCOPES.filter((s) => need.includes(s) && !standing.scopes.includes(s))
    return missing.length
      ? { ok: false, status: 403, error: missingScopeMessage(missing), missingScopes: missing }
      : { ok: true, role: 'co_commissioner', scopes: standing.scopes }
  }
  // One area per action, so "any of the user's co-commissioner seats holds it" is the union holding it.
  if (standing.scopes.includes(need)) {
    return { ok: true, role: 'co_commissioner', scopes: standing.scopes }
  }
  return { ok: false, status: 403, error: missingScopeMessage([need]), missingScopes: [need] }
}

/** For a route: null to go ahead, or the refusal to return as-is. */
export async function commissionerAccessResponse(
  leagueId: string,
  userId: string | null | undefined,
  need: CommissionerNeed | readonly CoCommissionerScope[],
): Promise<NextResponse | null> {
  const access = await commissionerAccess(leagueId, userId, need)
  if (access.ok) return null
  return NextResponse.json(
    { error: access.error, ...(access.missingScopes ? { code: 'co_commissioner_scope', missingScopes: access.missingScopes } : {}) },
    { status: access.status },
  )
}

/** Yes/no, for a GET deciding whether a screen is editable — the same answer the write will give. */
export async function canCommissionerAct(leagueId: string, userId: string | null | undefined, need: CommissionerNeed): Promise<boolean> {
  return (await commissionerAccess(leagueId, userId, need)).ok
}
