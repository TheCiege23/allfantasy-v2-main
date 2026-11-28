import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { canCommissionerAct, commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resolveViewingRoster } from '@/lib/league/viewerTeams'
import { sourcePlatformLabel } from '@/lib/league/write-authority'
import { hasTeamSwitched, isOfficialOnAllFantasy, readSwitchingState } from '@/lib/league/switching/switchingLeague'
import { isSeasonInProgress, makeLeagueOfficial } from '@/lib/league/switching/makeLeagueOfficial'

export const dynamic = 'force-dynamic'

/**
 * A switching league (lib/league/switching): an imported league that AllFantasy takes over mid-season.
 *
 * GET  — what the switching card shows: whether the league is official, the viewer's own team and whether it has
 *        switched, and for the head commissioner every team's state and the league's invite link.
 * POST — "Make it official", head commissioner only, in season only (lib/league/switching/makeLeagueOfficial.ts).
 *        409 = refused with a reason; nothing was written.
 */
type Session = { user?: { id?: string } } | null

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as Session
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true, status: true, lifecycleState: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const noStore = { headers: { 'Cache-Control': 'private, no-store' } }
  if (isNativePlatform(league.platform)) return NextResponse.json({ applies: false }, noStore)

  const official = isOfficialOnAllFantasy(league.settings)
  const state = readSwitchingState(league.settings)
  const [isHead, viewing, teams, rosters] = await Promise.all([
    canCommissionerAct(leagueId, userId, 'head'),
    resolveViewingRoster(leagueId, userId, null, { allowCoOwner: false }).catch(() => null),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true, teamName: true, ownerName: true }, orderBy: { teamName: 'asc' } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true } }),
  ])
  const externalOfRoster = new Map(rosters.map((r) => [r.id, String(record(r.playerData).source_team_id ?? '')]))
  const myExternal = viewing ? externalOfRoster.get(viewing.rosterId) : undefined
  const mine = myExternal ? teams.find((t) => t.externalId === myExternal) : undefined
  const invite = isHead && official
    ? await prisma.leagueInvite.findFirst({ where: { leagueId, isActive: true }, select: { token: true } })
    : null

  return NextResponse.json({
    applies: true,
    official,
    /** The switching period is over (step 5): every team runs here and nothing is copied any more. */
    ended: state?.ended != null,
    seasonInProgress: isSeasonInProgress(league),
    platformLabel: sourcePlatformLabel(league.platform),
    isHeadCommissioner: isHead,
    myTeam: mine ? { name: mine.teamName?.trim() || 'Your team', switched: hasTeamSwitched(league.settings, mine.id) } : null,
    teams: isHead
      ? teams.map((t) => ({ name: t.teamName?.trim() || 'A team', manager: t.ownerName?.trim() || null, switched: hasTeamSwitched(league.settings, t.id) }))
      : null,
    invitePath: invite ? `/join/${invite.token}` : null,
    // The teams that had not switched when it ended, for the head commissioner to follow up.
    leftBehind: isHead ? (state?.leftBehind ?? []).map((t) => ({ name: t.name, manager: t.manager })) : null,
  }, noStore)
}

export async function POST(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as Session
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, userId, 'head')
  if (refused) return refused

  const result = await makeLeagueOfficial({ leagueId, userId })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
