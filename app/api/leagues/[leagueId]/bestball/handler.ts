import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { normalizeBestBallSettings, getBestBallSportProfile, buildBestBallSettingsSummary } from '@/lib/bestball/rules'
import type { LeagueSport } from '@prisma/client'
import { loadNativeBestBallTab } from '@/lib/bestball/nativeBestBallTabLoad'
import { currentSeasonAwaitsDraft, draftPendingNotice } from '@/lib/bestball/nativeBestBallTab'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { withEffectiveScoringPeriod } from '@/lib/bestball/scoringPeriod'
import { structuralSettingsLockReason } from '@/lib/league/structuralSettingsLock'
import { dailyScheduleWaitingNotice, loadDailyBestBallScheduleStatus } from '@/lib/bestball/dailyScheduleStatus'

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
      leagueSize: true,
      bestBallMode: true,
      settings: true,
      bbMatchupFormat: true,
      bbScoringPeriod: true,
      platform: true,
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
  // The period the league is ACTUALLY scored with (a legacy NBA/NHL/MLB "daily" default reads weekly), and
  // the same team count the settings PATCH normalizes with, so the panel round-trips without a "change".
  const bestBallSettings = normalizeBestBallSettings({
    sport: league.sport as LeagueSport,
    teamCount: typeof league.leagueSize === 'number' && league.leagueSize > 0 ? league.leagueSize : undefined,
    conceptSetup: withEffectiveScoringPeriod(String(league.sport), settingsRecord),
    draftType: typeof settingsRecord.canonical_draft_mode === 'string' ? settingsRecord.canonical_draft_mode : 'snake',
    timezone: typeof settingsRecord.timezone === 'string' ? settingsRecord.timezone : null,
    language: typeof settingsRecord.language === 'string' ? settingsRecord.language : null,
  })
  // The league's own seats (what its matchups are scored on), not the sport default — finding #22.
  const profile = getBestBallSportProfile(league.sport, league.settings ?? {})

  // A league AllFantasy scores itself is read from what native scoring writes; the legacy tables below
  // stay for the leagues that have no native season.
  const native = await loadNativeBestBallTab({
    leagueId,
    platform: league.platform,
    sport: String(league.sport),
    settings: league.settings,
    requestedWeek: Number.parseInt(req.nextUrl.searchParams.get('week') ?? '', 10),
    rankBy: bestBallSettings.matchupFormat === 'cumulative' ? 'points' : 'record',
  })
  // Why scoring and competition settings are frozen (the draft has started / the season exists), or null.
  const structureLock = await structuralSettingsLockReason(leagueId).catch(() => null)
  // Daily best ball needs the season's regular-season opener (recorded, or derived from the stored
  // schedule). Without one it cannot score days, and the panel and the tab say so rather than nothing.
  // Only for a league we score ourselves, and never for a tournament (always weekly).
  const dailySchedule =
    resolveWriteAuthority(league.platform) === 'NATIVE' && bestBallSettings.contestStructure !== 'tournament'
      ? await loadDailyBestBallScheduleStatus(
          { sport: String(league.sport), season: native ? native.season : league.season },
          { db: prisma as never },
        ).catch(() => null)
      : null
  const dailyScheduleNotice = bestBallSettings.scoringPeriod === 'daily' ? dailyScheduleWaitingNotice(dailySchedule) : null
  // A league we host whose CURRENT season has no native season yet: that season's draft has not
  // finished, so nothing in it can be scored. With no native season at all the tab is empty; with an
  // older one (a renewed league mid-draft) the tab would otherwise show last season as if it were this
  // one. Either way, say so.
  let draftNotice: string | null = null
  if (
    resolveWriteAuthority(league.platform) === 'NATIVE' &&
    currentSeasonAwaitsDraft(league.season, native ? native.season : null)
  ) {
    try {
      const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
      draftNotice = draftPendingNotice(draft?.status, native ? native.season : null)
    } catch {
      draftNotice = null
    }
  }
  if (native) {
    return NextResponse.json({
      league: {
        id: league.id,
        name: league.name,
        sport: league.sport,
        season: native.season,
        summary: buildBestBallSettingsSummary(bestBallSettings),
        settings: bestBallSettings,
        profile,
        structureLock,
      },
      source: 'native',
      ...native.body,
      draftNotice,
      dailySchedule,
      dailyScheduleNotice,
    })
  }

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
      structureLock,
    },
    selectedWeek,
    weeksAvailable,
    draftNotice,
    dailySchedule,
    dailyScheduleNotice,
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
