import { prisma } from '@/lib/prisma'
import { calculateScoreFromSportConfig } from './scoringEngine'
import {
  findCachedWeekPayload,
  isTeamDefenseRow,
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
  pointsAllowedFromGame,
  teamAbbrevFromDefPlayerId,
} from '@/lib/scoring-runtime/nflStatNormalization'
export {
  findCachedWeekPayload,
  isTeamDefenseRow,
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
  pointsAllowedFromGame,
  teamAbbrevFromDefPlayerId,
} from '@/lib/scoring-runtime/nflStatNormalization'

export type WeeklyScoreSyncSummary = {
  leagueId: string
  seasonId: string
  sport: string
  season: number
  week: number
  rosteredPlayers: number
  cacheRowsRead: number
  scoresUpserted: number
  missingCachePlayerIds: string[]
  missingWeekPlayerIds: string[]
  missingStatPlayerIds: string[]
  warnings: string[]
}

/**
 * Team-Defense / Special-Teams (DST) stat normalizer. Kept SEPARATE from
 * `normalizeNflWeeklyStats` because several DST keys collide with offensive
 * keys under the same name from the provider (`sack`, `int`, `fum_rec` mean
 * sacks/INTs/fumbles *by the defense* for a DST row, but the opposite for a QB).
 * The score-sync chooses this normalizer only for team-defense roster rows, so
 * offensive players never pick up def_* keys. Emits the canonical `def_*` keys
 * the NFL `team_def` scoring categories read.
 */
/** True for a roster row that represents a team defense (DEF/DST slot). */

/** Parse the team abbreviation from a synthetic team-defense player id (`nfl:def:KC` → `KC`). */

/**
 * Points allowed by a team's defense in a game = the opponent's final score.
 * Pure so it is unit-testable; returns null when the team is not in the game or
 * the score is not yet final/available.
 */

function candidateSportKeys(sport: string): string[] {
  const upper = sport.toUpperCase()
  const lower = sport.toLowerCase()
  return upper === lower ? [upper] : [upper, lower]
}

async function recordScoreSyncAudit(summary: WeeklyScoreSyncSummary, actorId: string) {
  try {
    await (prisma as any).adminAuditLog?.create({
      data: {
        adminUserId: actorId,
        action: 'redraft_score_sync',
        targetType: 'redraft_season',
        targetId: summary.seasonId,
        details: summary,
      },
    })
  } catch {
    // Audit is best-effort; the sync result remains the source of truth for callers.
  }
}

export async function syncPlayerWeeklyScoresForRedraftSeason(params: {
  seasonId?: string
  leagueId?: string
  week?: number
  actorId?: string
}): Promise<WeeklyScoreSyncSummary> {
  const season = await prisma.redraftSeason.findFirst({
    where: params.seasonId ? { id: params.seasonId } : { leagueId: params.leagueId },
    orderBy: params.seasonId ? undefined : { createdAt: 'desc' },
  })

  if (!season) {
    throw new Error('Redraft season not found')
  }

  const week = Math.max(1, Number(params.week ?? season.currentWeek ?? 1) || 1)
  const sport = String(season.sport || 'NFL').toUpperCase()
  const seasonYear = Number(season.season)

  if (sport !== 'NFL') {
    throw new Error(`Weekly stat sync is currently wired for NFL only; ${sport} is not available yet.`)
  }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)
  const rosterPlayers = rosterIds.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: rosterIds }, droppedAt: null },
        select: { playerId: true, sport: true, position: true, team: true },
      })
    : []

  const playerIds: string[] = Array.from(new Set(rosterPlayers.map((p: { playerId: string }) => p.playerId).filter(Boolean)))
  const summary: WeeklyScoreSyncSummary = {
    leagueId: season.leagueId,
    seasonId: season.id,
    sport,
    season: seasonYear,
    week,
    rosteredPlayers: playerIds.length,
    cacheRowsRead: 0,
    scoresUpserted: 0,
    missingCachePlayerIds: [],
    missingWeekPlayerIds: [],
    missingStatPlayerIds: [],
    warnings: [],
  }

  if (!playerIds.length) {
    summary.warnings.push('No rostered players found for this redraft season.')
    await recordScoreSyncAudit(summary, params.actorId ?? 'system')
    return summary
  }

  const cachedRows = await prisma.playerGameLogCache.findMany({
    where: {
      playerId: { in: playerIds },
      season: String(seasonYear),
      seasonType: 'regular',
      sport: { in: candidateSportKeys(sport) },
    },
  })
  summary.cacheRowsRead = cachedRows.length

  const cacheByPlayer = new Map<string, { payload: unknown }>(
    cachedRows.map((row: { playerId: string; payload: unknown }) => [row.playerId, row]),
  )
  const sportByPlayer = new Map(rosterPlayers.map((p) => [p.playerId, String(p.sport || sport).toUpperCase()]))
  const positionByPlayer = new Map(
    rosterPlayers.map((p: { playerId: string; position: string | null }) => [p.playerId, p.position ?? null]),
  )
  const teamByPlayer = new Map(
    rosterPlayers.map((p: { playerId: string; team: string | null }) => [p.playerId, p.team ?? null]),
  )

  // Team-defense points-allowed is derivable from the real game result we
  // already ingest (`SportsGame`): a defense's points-allowed = the opponent's
  // final score. Pre-load this week's finished games keyed by team abbrev so a
  // DEF starter scores from data we have, even without a per-team box-score
  // provider feed. (Sacks/INT/etc. still require the box-score feed — see G8.)
  const teamDefensePlayerIds = playerIds.filter((id) => isTeamDefenseRow(id, positionByPlayer.get(id) ?? null))
  const gameByTeam = new Map<string, { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null }>()
  if (teamDefensePlayerIds.length > 0) {
    const games = await prisma.sportsGame.findMany({
      where: { sport: { in: candidateSportKeys(sport) }, season: seasonYear, week },
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true },
    })
    for (const g of games) {
      const home = String(g.homeTeam ?? '').trim().toUpperCase()
      const away = String(g.awayTeam ?? '').trim().toUpperCase()
      if (home) gameByTeam.set(home, g)
      if (away) gameByTeam.set(away, g)
    }
  }

  for (const playerId of playerIds) {
    const position = positionByPlayer.get(playerId) ?? null
    const playerSport = sportByPlayer.get(playerId) ?? sport

    if (isTeamDefenseRow(playerId, position)) {
      const cached = cacheByPlayer.get(playerId)
      const weekPayload = cached ? findCachedWeekPayload(cached.payload, week) : null
      const stats: Record<string, number> = weekPayload ? normalizeNflTeamDefenseWeeklyStats(weekPayload) : {}

      // Derive points allowed from the game result when the box-score feed did
      // not already provide it.
      if (stats.def_points_allowed === undefined) {
        const team = teamAbbrevFromDefPlayerId(playerId) ?? String(teamByPlayer.get(playerId) ?? '').trim().toUpperCase()
        const game = team ? gameByTeam.get(team) : undefined
        if (game) {
          const pa = pointsAllowedFromGame(game, team)
          if (pa !== null) stats.def_points_allowed = pa
        }
      }

      if (!Object.keys(stats).length) {
        // No box score and no finished game yet — nothing to score this week.
        if (!cached) summary.missingCachePlayerIds.push(playerId)
        else summary.missingWeekPlayerIds.push(playerId)
        continue
      }

      const fantasyPts = await calculateScoreFromSportConfig(season.leagueId, playerId, week, stats, position)
      await prisma.playerWeeklyScore.upsert({
        where: { playerId_week_season_sport: { playerId, week, season: seasonYear, sport: playerSport } },
        update: { stats, fantasyPts, isFinalized: false },
        create: { playerId, week, season: seasonYear, sport: playerSport, stats, fantasyPts, isFinalized: false },
      })
      summary.scoresUpserted += 1
      continue
    }

    const cached = cacheByPlayer.get(playerId)
    if (!cached) {
      summary.missingCachePlayerIds.push(playerId)
      continue
    }

    const weekPayload = findCachedWeekPayload(cached.payload, week)
    if (!weekPayload) {
      summary.missingWeekPlayerIds.push(playerId)
      continue
    }

    const stats = normalizeNflWeeklyStats(weekPayload)
    if (!Object.keys(stats).length) {
      summary.missingStatPlayerIds.push(playerId)
      continue
    }
    const fantasyPts = await calculateScoreFromSportConfig(season.leagueId, playerId, week, stats, positionByPlayer.get(playerId) ?? null)

    await prisma.playerWeeklyScore.upsert({
      where: {
        playerId_week_season_sport: {
          playerId,
          week,
          season: seasonYear,
          sport: playerSport,
        },
      },
      update: {
        stats,
        fantasyPts,
        isFinalized: false,
      },
      create: {
        playerId,
        week,
        season: seasonYear,
        sport: playerSport,
        stats,
        fantasyPts,
        isFinalized: false,
      },
    })
    summary.scoresUpserted += 1
  }

  if (summary.missingCachePlayerIds.length) {
    summary.warnings.push('Some rostered players do not have cached game logs. Run the provider/cache job before score sync.')
  }
  if (summary.missingWeekPlayerIds.length) {
    summary.warnings.push(`Some cached players do not have week ${week} rows yet.`)
  }
  if (summary.missingStatPlayerIds.length) {
    summary.warnings.push('Some cached week rows did not contain recognized NFL stat keys.')
  }

  await recordScoreSyncAudit(summary, params.actorId ?? 'system')
  return summary
}
