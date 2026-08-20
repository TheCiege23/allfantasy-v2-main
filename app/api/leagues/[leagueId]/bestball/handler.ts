import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { normalizeBestBallSettings, getBestBallSportProfile, buildBestBallSettingsSummary } from '@/lib/bestball/rules'
import type { LeagueSport } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      sport: true,
      season: true,
      bestBallMode: true,
      settings: true,
      bbMatchupFormat: true,
      bbScoringPeriod: true,
      rosters: {
        select: {
          id: true,
          platformUserId: true,
          playerData: true,
        },
      },
      teams: {
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          platformUserId: true,
        },
      },
    },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!league.bestBallMode) return NextResponse.json({ error: 'Not a Best Ball league' }, { status: 400 })

  // Canonical membership predicate. This previously accepted only a RedraftLeagueMember row or
  // the nullable `LeagueTeam.platformUserId`, so it 403'd the league owner, every Roster-backed
  // member of an imported league, and claim-only managers. `league.teams` above is still selected,
  // but for display only — never for access.
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const settingsRecord =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const bestBallSettings = normalizeBestBallSettings({
    sport: league.sport as LeagueSport,
    conceptSetup: (settingsRecord.best_ball_settings as Record<string, unknown> | null) ?? null,
    draftType: typeof settingsRecord.canonical_draft_mode === 'string' ? settingsRecord.canonical_draft_mode : 'snake',
    timezone: typeof settingsRecord.timezone === 'string' ? settingsRecord.timezone : null,
    language: typeof settingsRecord.language === 'string' ? settingsRecord.language : null,
  })
  const profile = getBestBallSportProfile(league.sport)

  const playedWeeks = await prisma.teamWeekResult.findMany({
    where: { leagueId, season: league.season },
    select: { week: true },
    orderBy: { week: 'asc' },
  })
  const weeksAvailable = Array.from(new Set(playedWeeks.map((row) => row.week))).sort((a, b) => a - b)
  const requestedWeek = Number.parseInt(req.nextUrl.searchParams.get('week') ?? '', 10)
  const selectedWeek =
    Number.isFinite(requestedWeek) && weeksAvailable.includes(requestedWeek)
      ? requestedWeek
      : weeksAvailable[weeksAvailable.length - 1] ?? 1

  const [weeklyScores, weeklyResults, standings, historyRows] = await Promise.all([
    prisma.weeklyScore.findMany({
      where: { leagueId, season: league.season, week: selectedWeek },
      orderBy: [{ rosterId: 'asc' }, { isStarter: 'desc' }, { points: 'desc' }],
    }),
    prisma.teamWeekResult.findMany({
      where: { leagueId, season: league.season, week: selectedWeek },
      orderBy: { totalPoints: 'desc' },
    }),
    prisma.fantasyStanding.findMany({
      where: { leagueId, season: league.season },
      orderBy: [{ rank: 'asc' }],
      take: 16,
    }),
    prisma.teamWeekResult.findMany({
      where: { leagueId, season: league.season },
      select: { rosterId: true, week: true, totalPoints: true },
      orderBy: [{ week: 'asc' }],
    }),
  ])

  const allPlayerIds = Array.from(new Set(weeklyScores.map((row) => row.playerId)))
  const playerMeta = await prisma.sportsPlayer.findMany({
    where: { id: { in: allPlayerIds } },
    select: { id: true, name: true, position: true, team: true },
  })
  const playerMap = new Map(playerMeta.map((player) => [player.id, player]))
  const teamMap = new Map(
    league.teams.map((team) => {
      const rosterId =
        league.rosters.find((roster) => roster.platformUserId && roster.platformUserId === team.platformUserId)?.id ??
        null
      return [rosterId ?? team.id, team]
    }),
  )

  const rosterComposition = league.rosters.map((roster) => {
    const playerIds =
      Array.isArray((roster.playerData as Record<string, unknown> | null)?.players)
        ? (((roster.playerData as Record<string, unknown>).players as unknown[]).map((entry) =>
            typeof entry === 'string'
              ? entry
              : String((entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).player_id ?? ''),
          ).filter(Boolean) as string[])
        : []
    return {
      rosterId: roster.id,
      teamName: teamMap.get(roster.id)?.teamName ?? teamMap.get(roster.id)?.ownerName ?? 'Team',
      playerCount: playerIds.length,
    }
  })

  const lineupCards = weeklyResults.map((result) => {
    const rows = weeklyScores.filter((score) => score.rosterId === result.rosterId)
    const starters = rows
      .filter((row) => row.isStarter)
      .map((row) => {
        const player = playerMap.get(row.playerId)
        const statLine =
          row.statLine && typeof row.statLine === 'object' && !Array.isArray(row.statLine)
            ? (row.statLine as Record<string, unknown>)
            : {}
        return {
          playerId: row.playerId,
          name: player?.name ?? row.playerId,
          position: player?.position ?? 'UTIL',
          team: player?.team ?? null,
          points: row.points,
          slot: typeof statLine.bestBallSlot === 'string' ? statLine.bestBallSlot : null,
        }
      })
    const bench = rows
      .filter((row) => !row.isStarter)
      .map((row) => {
        const player = playerMap.get(row.playerId)
        return {
          playerId: row.playerId,
          name: player?.name ?? row.playerId,
          position: player?.position ?? 'UTIL',
          team: player?.team ?? null,
          points: row.points,
        }
      })
    return {
      rosterId: result.rosterId,
      teamName: teamMap.get(result.rosterId)?.teamName ?? teamMap.get(result.rosterId)?.ownerName ?? 'Team',
      totalPoints: result.totalPoints,
      winLoss: result.winLoss,
      starters,
      bench,
    }
  })

  return NextResponse.json({
    league: {
      id: league.id,
      name: league.name,
      sport: league.sport,
      season: league.season,
      summary: buildBestBallSettingsSummary(bestBallSettings),
      settings: bestBallSettings,
      profile,
    },
    selectedWeek,
    weeksAvailable,
    lineups: lineupCards,
    rosterComposition,
    standings: standings.map((row) => ({
      rosterId: row.rosterId,
      rank: row.rank,
      teamName: teamMap.get(row.rosterId)?.teamName ?? teamMap.get(row.rosterId)?.ownerName ?? 'Team',
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    })),
    history: historyRows,
  })
}
