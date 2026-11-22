import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { calculateScoreFromSportConfig, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { loadDailyLineupView } from '@/lib/redraft/dailyLineupView'
import type { RosterScorePlayer } from '@/lib/types/liveScoring'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/scoring/roster-scores?rosterId=X&week=Y&season=Z
 * Returns per-player score breakdown for a RedraftRoster for a given week.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const rosterId = sp.get('rosterId')
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })

  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { currentWeek: true, season: true },
  })
  const week = Math.max(1, Math.min(40, Number(sp.get('week')) || redraftSeason?.currentWeek || 1))
  const season = Math.max(2000, Math.min(2100, Number(sp.get('season')) || redraftSeason?.season || new Date().getFullYear()))

  /*
   * A daily-lineup league's week is Σ days of that day's starters, so its breakdown is each player's
   * points on the days he STARTED (`dailyLineupView.ts`, the scorer's own rule), plus the days.
   */
  const daily = await loadDailyLineupView(prisma, { leagueId, redraftRosterId: rosterId, season, week })
  if (daily) {
    const rows = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId, playerId: { in: Object.keys(daily.startedPoints) } },
      select: { playerId: true, playerName: true, position: true, slotType: true },
    })
    // Final once the finalizer has sealed his weekly row, as the matchup itself decides.
    const sealed = await prisma.playerWeeklyScore.findMany({
      where: { playerId: { in: rows.map((r) => r.playerId) }, week, season, isFinalized: true },
      select: { playerId: true },
    })
    const sealedIds = new Set(sealed.map((r) => r.playerId))
    const players: RosterScorePlayer[] = rows
      .map((p) => ({
        playerName: p.playerName,
        position: p.position,
        slotType: p.slotType,
        pts: daily.startedPoints[p.playerId] ?? 0,
        isFinalized: sealedIds.has(p.playerId),
        hasStats: true,
      }))
      .sort((a, b) => b.pts - a.pts)
    return NextResponse.json({ week, season, rosterId, players, daily })
  }

  const players = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId, droppedAt: null },
    select: { playerId: true, playerName: true, position: true, slotType: true, sport: true },
  })

  /*
   * ⚠ THIS IS THE BREAKDOWN BEHIND A WEEK'S MATCHUP SCORE, so it picks starters the way the matchup
   * does: from the lineup saved for THAT week, falling back to current `slotType`
   * (`lib/redraft/weekLineupSlots.ts`). Reading `slotType` alone listed next week's lineup under
   * last week's total once a manager had set it.
   */
  const weekLineups = await loadWeekLineups(prisma, { redraftRosterIds: [rosterId], season, week })
  const starters = players
    .map((p) => ({ ...p, slotType: weekSlotType({ ...p, rosterId }, weekLineups) }))
    .filter((p) => isScoringStarterSlot(p.slotType))

  const results: RosterScorePlayer[] = await Promise.all(
    starters.map(async (p) => {
      const scoreRow = await prisma.playerWeeklyScore.findUnique({
        where: { playerId_week_season_sport: { playerId: p.playerId, week, season, sport: p.sport } },
        select: { stats: true, isFinalized: true },
      })

      if (!scoreRow?.stats) {
        return {
          playerName: p.playerName,
          position: p.position,
          slotType: p.slotType,
          pts: 0,
          isFinalized: false,
          hasStats: false,
        }
      }

      const rawStats = scoreRow.stats as Record<string, number>
      const pts = await calculateScoreFromSportConfig(leagueId, p.playerId, week, rawStats, p.position)

      return {
        playerName: p.playerName,
        position: p.position,
        slotType: p.slotType,
        pts: Math.round(pts * 100) / 100,
        isFinalized: scoreRow.isFinalized ?? false,
        hasStats: true,
      }
    }),
  )

  results.sort((a, b) => b.pts - a.pts)

  return NextResponse.json({ week, season, rosterId, players: results })
}
