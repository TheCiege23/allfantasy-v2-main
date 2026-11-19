/**
 * The teams the signed-in manager runs in this league, and which one is active.
 *
 *   GET   { teams: [{ rosterId, teamName }], activeRosterId }
 *   POST  { rosterId }  switch the active team (lib/league/viewerTeams.ts remembers it in a cookie)
 *
 * A manager with one team gets that team back from GET and has nothing to switch.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  ACTIVE_TEAMS_COOKIE, activeTeamsCookieAfterSwitch, leagueTeamsForRosters, listHeldTeams, requestedRosterIdFrom, resolveViewingRoster,
} from '@/lib/league/viewerTeams'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function signedIn(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { leagueId } = await ctx.params
  return userId && leagueId ? { userId, leagueId } : null
}

async function teamsFor(leagueId: string, userId: string) {
  const held = await listHeldTeams(leagueId, userId)
  if (held.length === 0) return []
  const names = await prisma.leagueTeam.findMany({
    where: { leagueId, OR: [{ claimedByUserId: userId }, { externalId: { in: held.map(team => team.rosterId) } }] },
    select: { externalId: true, teamName: true },
  })
  const franchises = await leagueTeamsForRosters(leagueId, held.map(team => team.rosterId), names)
  return held.map((team, index) => ({ rosterId: team.rosterId, teamName: franchises.get(team.rosterId)?.teamName?.trim() || `Team ${index + 1}` }))
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const who = await signedIn(ctx)
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [teams, viewing] = await Promise.all([
    teamsFor(who.leagueId, who.userId),
    resolveViewingRoster(who.leagueId, who.userId, requestedRosterIdFrom(req), { allowCoOwner: false }),
  ])
  return NextResponse.json({ teams, activeRosterId: viewing?.rosterId ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const who = await signedIn(ctx)
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const rosterId = typeof body.rosterId === 'string' ? body.rosterId.trim() : ''
  const teams = await teamsFor(who.leagueId, who.userId)
  if (!rosterId || !teams.some((team) => team.rosterId === rosterId)) {
    return NextResponse.json({ error: 'That team is not yours.', code: 'NOT_YOUR_TEAM' }, { status: 403 })
  }
  const res = NextResponse.json({ ok: true, teams, activeRosterId: rosterId }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(
    ACTIVE_TEAMS_COOKIE,
    activeTeamsCookieAfterSwitch(req.cookies.get(ACTIVE_TEAMS_COOKIE)?.value, rosterId, teams.map((team) => team.rosterId)),
    { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 60 * 60 * 24 * 365 },
  )
  return res
}
