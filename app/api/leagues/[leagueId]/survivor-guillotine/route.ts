import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { resolveLeagueAccess } from '@/lib/league-access'
import { parseSGLiveConfig } from '@/lib/survivor-guillotine/config'
import { awardSGLiveWeeklyPower, configureSGLivePeriod, readSGLivePowers, readSGPeriodState, readSGTribes,
  saveSGLiveLeague, seedSGLiveDraftPowers } from '@/lib/survivor-guillotine/live'
import type { SGTribeMember, SGLivePeriod } from '@/lib/survivor-guillotine/live'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { readSGTribeDraftState } from '@/lib/survivor-guillotine/operations'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }
async function actor() { return (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id }

export async function GET(_req: NextRequest, context: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season) return NextResponse.json({ error: 'Survivor Guillotine is not configured' }, { status: 404 })
  const powers = await readSGLivePowers(leagueId, userId)
  const fullPeriodState = readSGPeriodState(season.periodState)
  const periodState = fullPeriodState ? (({ chopSnapshot: _private, commissionerTie: _decision,
    ...publicState }) => publicState)(fullPeriodState) : null
  const chops = await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null },
    select: { id: true, leagueId: true, period: true, rosterId: true, score: true, tribeId: true, createdAt: true },
    orderBy: [{ period: 'desc' }, { score: 'asc' }] })
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true } })
  const [teams, ownedTeam, scores] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { legacyRosterId: true, teamName: true,
      ownerName: true, eliminatedAt: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId, eliminatedAt: null,
      legacyRosterId: { not: null } }, select: { legacyRosterId: true } }),
    prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, week: season.currentPeriod },
      select: { rosterId: true, totalPoints: true, status: true } }),
  ])
  const roster = ownedTeam?.legacyRosterId ? await prisma.roster.findUnique({ where: { id: ownedTeam.legacyRosterId },
    select: { playerData: true, faabRemaining: true } }) : null
  const playerIds = roster ? getRosterPlayerIds(roster.playerData) : []
  const [players, dailyLineups, ownBid, ownTribeChoice] = await Promise.all([
    prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, name: true, position: true, team: true } }),
    ownedTeam?.legacyRosterId ? prisma.survivorGuillotineDailyLineup.findMany({ where: { leagueId,
      period: season.currentPeriod, rosterId: ownedTeam.legacyRosterId }, select: { gameDay: true, playerIds: true } }) : [],
    ownedTeam?.legacyRosterId ? prisma.survivorGuillotineAuctionBid.findUnique({ where: {
      leagueId_period_rosterId: { leagueId, period: season.currentPeriod, rosterId: ownedTeam.legacyRosterId } },
      select: { amount: true, status: true } }) : null,
    ownedTeam?.legacyRosterId ? prisma.survivorGuillotineTribeChoice.findUnique({ where: {
      leagueId_rosterId: { leagueId, rosterId: ownedTeam.legacyRosterId } }, select: { tribeId: true } }) : null,
  ])
  return NextResponse.json({ season: { leagueId, config: season.config, tribes: readSGTribes(season.tribes),
    periodState, currentPeriod: season.currentPeriod,
    status: season.status, revision: season.revision, periodHistory: season.periodHistory,
    tribeDraftState: readSGTribeDraftState(season.tribeDraftState) }, powers, chops,
    teams, scores, ownRoster: ownedTeam?.legacyRosterId ? { id: ownedTeam.legacyRosterId,
      faabRemaining: roster?.faabRemaining ?? 0, players, dailyLineups, ownBid,
      tribeChoice: ownTribeChoice?.tribeId ?? null } : null })
}

export async function PUT(req: NextRequest, context: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await assertLeagueCommissioner(leagueId, userId)
  if (!access.ok) return NextResponse.json({ error: 'Commissioner access required' }, { status: access.status })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    if (body.action === 'rules') {
      const result = await saveSGLiveLeague(leagueId, parseSGLiveConfig(body.config))
      return NextResponse.json({ result })
    }
    if (body.action === 'period') {
      if (!Array.isArray(body.tribes) || !body.periodState || typeof body.periodState !== 'object') throw new Error('Tribes and period state are required.')
      if (!Number.isInteger(body.revision)) throw new Error('Current season revision is required.')
      const state = body.periodState as SGLivePeriod
      if (!Number.isInteger(state.period) || !Array.isArray(state.matchups) || !Array.isArray(state.champions) ||
          !Array.isArray(state.sitOuts) || !Array.isArray(state.priorSitOuts) || typeof state.ceremonyStarted !== 'boolean' ||
          (state.ceremonyAt !== null && typeof state.ceremonyAt !== 'string') ||
          (state.scoringStartsAt != null && typeof state.scoringStartsAt !== 'string') ||
          (state.scoringEndsAt != null && typeof state.scoringEndsAt !== 'string') ||
          (state.immunityDeadlineAt != null && typeof state.immunityDeadlineAt !== 'string') ||
          (state.playerPowerDeadlineAt != null && typeof state.playerPowerDeadlineAt !== 'string') ||
          state.matchups.some(m => !m || typeof m.team1 !== 'string' || typeof m.team2 !== 'string') ||
          [...state.champions, ...state.sitOuts, ...state.priorSitOuts].some(id => typeof id !== 'string')) throw new Error('Invalid period state.')
      const result = await configureSGLivePeriod(leagueId, body.tribes as SGTribeMember[], state, Number(body.revision))
      return NextResponse.json({ result })
    }
    if (body.action === 'seed_draft_powers') {
      if (!Array.isArray(body.playerIds) || body.playerIds.some(x => typeof x !== 'string') || !Number.isInteger(body.count)) throw new Error('Choose valid draft players and a power count.')
      const result = await seedSGLiveDraftPowers(leagueId, body.playerIds as string[], Number(body.count))
      return NextResponse.json({ result })
    }
    if (body.action === 'award_weekly_power') {
      if (!Number.isInteger(body.period)) throw new Error('Scoring period required.')
      const result = await awardSGLiveWeeklyPower(leagueId, Number(body.period))
      return NextResponse.json({ result })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save season' }, { status: 400 })
  }
}
