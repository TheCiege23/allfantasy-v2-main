import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
/**
 * GET: Merged Devy / C2C league summary for Overview/C2C Home. PROMPT 2/6.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isC2CLeague, getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { getCurrentC2CDraftPhase } from '@/lib/merged-devy-c2c/draft/C2CDraftOrchestration'
import { getC2CUnifiedStandings } from '@/lib/merged-devy-c2c/standings/C2CStandingsService'
import { buildCampusLineup, campusShare, graduatingRights } from '@/lib/merged-devy-c2c/c2cHomeView'
import { devyFeedItems } from '@/lib/devy/devyHomeView'
import { prisma } from '@/lib/prisma'

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

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C / Merged Devy league' }, { status: 404 })

  const [config, draftPhase] = await Promise.all([
    getC2CConfig(leagueId),
    getCurrentC2CDraftPhase(leagueId),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

  // The specialty home (handoff c2c/C2CHome). Additive: a failure leaves the original summary intact.
  const home = await buildC2CHomeBlock(leagueId, userId).catch(() => null)

  return NextResponse.json({
    leagueId,
    sport: config.sport,
    sportAdapterId: config.sportAdapterId,
    config: {
      startupFormat: config.startupFormat,
      mergedStartupDraft: config.mergedStartupDraft,
      separateStartupCollegeDraft: config.separateStartupCollegeDraft,
      collegeRosterSize: config.collegeRosterSize,
      collegeActiveLineupSlots: config.collegeActiveLineupSlots,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      collegeDraftRounds: config.collegeDraftRounds,
      bestBallPro: config.bestBallPro,
      bestBallCollege: config.bestBallCollege,
      standingsModel: config.standingsModel,
      mergedRookieCollegeDraft: config.mergedRookieCollegeDraft,
      startupDraftType: config.startupDraftType,
      rookieDraftType: config.rookieDraftType,
      collegeDraftType: config.collegeDraftType,
    },
    draftPhase: draftPhase.phase,
    draftPhaseInfo: draftPhase.phaseInfo,
    sessionId: draftPhase.sessionId,
    league: home?.league ?? null,
    my: home?.my ?? null,
    feed: home?.feed ?? [],
  })
}

async function buildC2CHomeBlock(leagueId: string, userId: string) {
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  const [league, roster, events, standings] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, season: true, leagueSize: true } }),
    prisma.roster.findFirst({ where: coOwnerRosterId ? { leagueId, id: coOwnerRosterId } : { leagueId, platformUserId: userId }, select: { id: true } }),
    prisma.devyLifecycleEvent.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, eventType: true, devyPlayerId: true, createdAt: true },
    }),
    getC2CUnifiedStandings(leagueId).catch(() => null),
  ])
  const season = league?.season ?? new Date().getFullYear()
  const rights = roster
    ? await prisma.devyRights.findMany({
        where: { leagueId, rosterId: roster.id },
        select: { id: true, devyPlayerId: true, state: true, c2cLineupRole: true },
      })
    : []
  const playerIds = [...new Set([...rights.map((r) => r.devyPlayerId), ...events.map((e) => e.devyPlayerId).filter((x): x is string => !!x)])]
  const [players, scores] = await Promise.all([
    playerIds.length
      ? prisma.devyPlayer.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, name: true, position: true, school: true, classYear: true, draftEligibleYear: true },
        })
      : [],
    roster && rights.length
      ? prisma.c2CScoringLog.findMany({
          where: { leagueId, rosterId: roster.id, season, devyPlayerId: { in: rights.map((r) => r.devyPlayerId) } },
          select: { devyPlayerId: true, season: true, week: true, points: true },
        })
      : [],
  ])
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const mine = roster && standings ? standings.rows.find((r) => r.rosterId === roster.id) ?? null : null
  const campus = buildCampusLineup(rights, players, scores, season)
  return {
    league: { name: league?.name ?? null, season, teamCount: league?.leagueSize ?? null },
    my: roster
      ? {
          rosterId: roster.id,
          campus,
          season: mine
            ? {
                rank: mine.rank,
                proPoints: mine.proPoints,
                collegePoints: mine.collegePoints,
                combinedPoints: mine.combinedPoints,
                campusShare: campusShare(mine.collegePoints, mine.proPoints),
              }
            : null,
          graduating: graduatingRights(rights, players, season),
        }
      : null,
    feed: devyFeedItems(events, (id) => nameById.get(id) ?? null),
  }
}
