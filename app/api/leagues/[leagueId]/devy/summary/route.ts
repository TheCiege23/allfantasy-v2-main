import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
/**
 * GET: Devy Dynasty league summary for Overview/DevyHome. PROMPT 2/6.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isDevyLeague, getDevyConfig } from '@/lib/devy/DevyLeagueConfig'
import { getCurrentDraftPhase } from '@/lib/devy/draft/DevyDraftOrchestration'
import { prisma } from '@/lib/prisma'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'
import { buildDevyStash, devyFeedItems, devyPipelineByYear } from '@/lib/devy/devyHomeView'
import { getRosterSize } from '@/lib/waiver-wire/roster-utils'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const [config, draftPhase, promotionEligibleCount] = await Promise.all([
    getDevyConfig(leagueId),
    getCurrentDraftPhase(leagueId),
    prisma.devyRights.count({
      where: { leagueId, state: DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE },
    }),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

  // The specialty home (handoff devy/DevyHome): the viewer's stash, pipeline and the league feed.
  // Additive: a failure here leaves the original summary intact rather than failing the route.
  const home = await buildDevyHomeBlock(leagueId, userId).catch(() => null)

  return NextResponse.json({
    leagueId,
    sport: config.sport,
    sportAdapterId: config.sportAdapterId,
    config: {
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
      startupVetRounds: config.startupVetRounds ?? null,
      bestBallEnabled: config.bestBallEnabled,
      startupDraftType: config.startupDraftType,
      rookieDraftType: config.rookieDraftType,
      devyDraftType: config.devyDraftType,
    },
    draftPhase: draftPhase.phase,
    draftPhaseInfo: draftPhase.phaseInfo,
    sessionId: draftPhase.sessionId,
    promotionEligibleCount,
    league: home?.league ?? null,
    my: home?.my ?? null,
    feed: home?.feed ?? [],
  })
}

async function buildDevyHomeBlock(leagueId: string, userId: string) {
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  const [league, roster, events] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { name: true, season: true, leagueSize: true, rosterSize: true },
    }),
    prisma.roster.findFirst({
      where: coOwnerRosterId ? { leagueId, id: coOwnerRosterId } : { leagueId, platformUserId: userId },
      select: { id: true, playerData: true },
    }),
    prisma.devyLifecycleEvent.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, eventType: true, devyPlayerId: true, createdAt: true },
    }),
  ])
  const seasonYear = league?.season ?? new Date().getFullYear()
  const rights = roster
    ? await prisma.devyRights.findMany({
        where: { leagueId, rosterId: roster.id },
        select: { id: true, devyPlayerId: true, state: true, slotCategory: true, promotedProPlayerId: true },
      })
    : []
  const playerIds = [...new Set([...rights.map((r) => r.devyPlayerId), ...events.map((e) => e.devyPlayerId).filter((x): x is string => !!x)])]
  const players = playerIds.length
    ? await prisma.devyPlayer.findMany({
        where: { id: { in: playerIds } },
        select: {
          id: true,
          name: true,
          position: true,
          school: true,
          classYear: true,
          draftEligibleYear: true,
          draftProjectionScore: true,
          devyValue: true,
        },
      })
    : []
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const stash = buildDevyStash(rights, players)
  return {
    league: {
      name: league?.name ?? null,
      season: seasonYear,
      teamCount: league?.leagueSize ?? null,
      rosterSize: league?.rosterSize ?? null,
    },
    my: roster
      ? {
          rosterId: roster.id,
          proRosterCount: getRosterSize(roster.playerData),
          stash,
          pipeline: devyPipelineByYear(stash, seasonYear),
        }
      : null,
    feed: devyFeedItems(events, (id) => nameById.get(id) ?? null),
  }
}
