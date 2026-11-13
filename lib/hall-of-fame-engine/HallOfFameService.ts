/**
 * HallOfFameService — create entries and moments; run induction from league data.
 */

import { prisma } from '@/lib/prisma'
import { normalizeSportForHallOfFame, isSupportedHallOfFameSport } from './SportHallOfFameResolver'
import { computeInductionScore } from './InductionScoreCalculator'
import { detectHistoricMoments, toMomentInput } from './HistoricMomentDetector'
import type { HallOfFameEntryInput, HallOfFameMomentInput } from './types'
import type { HallOfFameEntityType, HallOfFameCategory } from './types'

interface CreateEntryResult {
  id: string
  entityType: string
  entityId: string
  score: number
}

export async function createHallOfFameEntry(
  input: HallOfFameEntryInput
): Promise<CreateEntryResult | null> {
  const sport = normalizeSportForHallOfFame(input.sport)
  if (!isSupportedHallOfFameSport(sport)) return null

  const score = Number.isFinite(input.score) ? Math.max(0, Math.min(1, input.score)) : 0
  const entry = await prisma.hallOfFameEntry.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      sport,
      leagueId: input.leagueId ?? null,
      season: input.season ?? null,
      category: input.category,
      title: input.title,
      summary: input.summary ?? null,
      score,
      metadata: (input.metadata ?? {}) as object,
    },
  })
  return {
    id: entry.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    score: Number(entry.score),
  }
}

async function createHallOfFameMoment(
  input: HallOfFameMomentInput
): Promise<{ id: string; significanceScore: number } | null> {
  const sport = normalizeSportForHallOfFame(input.sport)
  if (!isSupportedHallOfFameSport(sport)) return null

  const score = Number.isFinite(input.significanceScore)
    ? Math.max(0, Math.min(1, input.significanceScore))
    : 0
  const moment = await prisma.hallOfFameMoment.create({
    data: {
      leagueId: input.leagueId,
      sport,
      season: input.season,
      headline: input.headline,
      summary: input.summary ?? null,
      relatedManagerIds: input.relatedManagerIds ?? [],
      relatedTeamIds: input.relatedTeamIds ?? [],
      relatedMatchupId: input.relatedMatchupId ?? null,
      significanceScore: score,
    },
  })
  return { id: moment.id, significanceScore: Number(moment.significanceScore) }
}

/**
 * Sync historic moments for a league (detect and upsert into HallOfFameMoment).
 * Idempotent by (leagueId, season, headline) — we create new moments per run for simplicity.
 */
export async function syncHistoricMomentsForLeague(
  leagueId: string,
  sport: string,
  options?: { maxSeasons?: number }
): Promise<{ created: number }> {
  const sportNorm = normalizeSportForHallOfFame(sport)
  if (!isSupportedHallOfFameSport(sportNorm)) return { created: 0 }

  const candidates = await detectHistoricMoments(leagueId, sportNorm, options)
  let created = 0
  for (const c of candidates) {
    const input = toMomentInput(c)
    const existing = await prisma.hallOfFameMoment.findFirst({
      where: {
        leagueId,
        season: c.season,
        headline: c.headline,
      },
    })
    if (existing) continue
    const result = await createHallOfFameMoment(input)
    if (result) created++
  }
  return { created }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

async function createOrUpdateEntry(input: HallOfFameEntryInput): Promise<{ created: boolean }> {
  const sport = normalizeSportForHallOfFame(input.sport)
  const existing = await prisma.hallOfFameEntry.findFirst({
    where: {
      leagueId: input.leagueId ?? null,
      sport,
      season: input.season ?? null,
      category: input.category,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
    },
  })
  const payload = {
    entityType: input.entityType,
    entityId: input.entityId,
    sport,
    leagueId: input.leagueId ?? null,
    season: input.season ?? null,
    category: input.category,
    title: input.title,
    summary: input.summary ?? null,
    score: clamp01(input.score),
    metadata: (input.metadata ?? {}) as object,
  }
  if (!existing) {
    await prisma.hallOfFameEntry.create({ data: payload })
    return { created: true }
  }
  await prisma.hallOfFameEntry.update({
    where: { id: existing.id },
    data: {
      summary: payload.summary,
      score: payload.score,
      metadata: payload.metadata,
    },
  })
  return { created: false }
}

function groupedChampionshipsByRoster(results: Array<{ rosterId: string; champion: boolean }>): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of results) {
    if (!row.champion) continue
    out.set(row.rosterId, (out.get(row.rosterId) ?? 0) + 1)
  }
  return out
}

function sortedSeasons(results: Array<{ season: string }>): string[] {
  return [...new Set(results.map((row) => String(row.season)))]
    .sort((a, b) => Number(b) - Number(a))
}

export async function runHallOfFameEngineForLeague(input: {
  leagueId: string
  sport?: string | null
  maxSeasons?: number
}): Promise<{
  entriesCreated: number
  entriesUpdated: number
  momentsCreated: number
  managersInducted: number
  teamsInducted: number
  dynastiesInducted: number
  championshipRunsInducted: number
  recordSeasonsInducted: number
  iconicRivalriesInducted: number
}> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, sport: true },
  })
  if (!league) throw new Error('League not found')
  const sport = normalizeSportForHallOfFame(input.sport ?? league.sport ?? null)
  const maxSeasons = Math.max(3, Math.min(30, input.maxSeasons ?? 12))

  const momentsSync = await syncHistoricMomentsForLeague(input.leagueId, sport, { maxSeasons })
  const [hofRows, seasonResults, rivalryRecords, matchupFacts, standingFacts] = await Promise.all([
    prisma.hallOfFameRow
      .findMany({
        where: { leagueId: input.leagueId },
        orderBy: { score: 'desc' },
        take: 120,
      })
      .catch(() => []),
    prisma.seasonResult
      .findMany({
        where: { leagueId: input.leagueId },
        orderBy: { season: 'desc' },
        take: 1200,
      })
      .catch(() => []),
    prisma.rivalryRecord
      .findMany({
        where: { leagueId: input.leagueId, sport },
        orderBy: { rivalryScore: 'desc' },
        take: 80,
      })
      .catch(() => []),
    prisma.matchupFact
      .findMany({
        where: { leagueId: input.leagueId, sport },
        orderBy: { createdAt: 'desc' },
        take: 600,
      })
      .catch(() => []),
    prisma.seasonStandingFact
      .findMany({
        where: { leagueId: input.leagueId, sport },
        take: 1500,
      })
      .catch(() => []),
  ])

  const seasons = sortedSeasons(seasonResults).slice(0, maxSeasons)
  const seasonSet = new Set(seasons)
  const scopedSeasonResults = seasonResults.filter((row) => seasonSet.has(String(row.season)))
  const championshipsByRoster = groupedChampionshipsByRoster(scopedSeasonResults)
  const createdCounter = {
    entriesCreated: 0,
    entriesUpdated: 0,
    managersInducted: 0,
    teamsInducted: 0,
    dynastiesInducted: 0,
    championshipRunsInducted: 0,
    recordSeasonsInducted: 0,
    iconicRivalriesInducted: 0,
  }

  const registerWrite = (created: boolean, bucket: keyof typeof createdCounter) => {
    if (created) createdCounter.entriesCreated += 1
    else createdCounter.entriesUpdated += 1
    createdCounter[bucket] += 1
  }

  for (const row of hofRows.slice(0, 30)) {
    const score = computeInductionScore(
      {
        championships: row.championships,
        seasonsPlayed: row.seasonsPlayed,
        dominance: toNumber(row.dominance),
        longevity: toNumber(row.longevity),
      },
      'MANAGER' as HallOfFameEntityType,
      'all_time_great_managers' as HallOfFameCategory
    )
    const result = await createOrUpdateEntry({
      entityType: 'MANAGER',
      entityId: row.rosterId,
      sport,
      leagueId: input.leagueId,
      category: 'all_time_great_managers',
      title: `All-Time Great Manager — ${row.rosterId}`,
      summary: `${row.championships} title(s) across ${row.seasonsPlayed} season(s). Hall score ${toNumber(
        row.score
      ).toFixed(3)}.`,
      score,
      metadata: {
        source: 'hall_of_fame_row',
        championships: row.championships,
        seasonsPlayed: row.seasonsPlayed,
        hallScore: toNumber(row.score),
      },
    })
    registerWrite(result.created, 'managersInducted')
  }

  for (const season of seasons) {
    const rows = scopedSeasonResults.filter((row) => String(row.season) === season)
    if (rows.length === 0) continue
    const sortedByWins = [...rows].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))
    const best = sortedByWins[0]
    const champ = rows.find((row) => row.champion) ?? null

    if (best) {
      const winRate =
        (best.wins ?? 0) + (best.losses ?? 0) > 0
          ? (best.wins ?? 0) / ((best.wins ?? 0) + (best.losses ?? 0))
          : 0
      const result = await createOrUpdateEntry({
        entityType: 'RECORD_SEASON',
        entityId: `${best.rosterId}:${season}`,
        sport,
        leagueId: input.leagueId,
        season,
        category: 'greatest_moments',
        title: `Record Season — ${best.rosterId} (${season})`,
        summary: `${best.wins ?? 0}-${best.losses ?? 0} with ${toNumber(best.pointsFor).toFixed(
          0
        )} points for.`,
        score: clamp01(0.45 + winRate * 0.4),
        metadata: {
          source: 'season_result',
          wins: best.wins ?? 0,
          losses: best.losses ?? 0,
          pointsFor: toNumber(best.pointsFor),
        },
      })
      registerWrite(result.created, 'recordSeasonsInducted')
    }

    if (champ) {
      const championships = championshipsByRoster.get(champ.rosterId) ?? 1
      const resultTeam = await createOrUpdateEntry({
        entityType: 'TEAM',
        entityId: champ.rosterId,
        sport,
        leagueId: input.leagueId,
        season,
        category: 'all_time_great_teams',
        title: `All-Time Great Team Candidate — ${champ.rosterId} (${season})`,
        summary: `Season champion in ${season}. ${championships} title(s) in reviewed seasons.`,
        score: clamp01(0.45 + Math.min(0.4, championships * 0.08)),
        metadata: {
          source: 'season_champion',
          season,
          championships,
          rosterId: champ.rosterId,
        },
      })
      registerWrite(resultTeam.created, 'teamsInducted')

      const resultRun = await createOrUpdateEntry({
        entityType: 'CHAMPIONSHIP_RUN',
        entityId: `${champ.rosterId}:${season}`,
        sport,
        leagueId: input.leagueId,
        season,
        category: 'best_championship_runs',
        title: `Championship Run — ${champ.rosterId} (${season})`,
        summary: `Completed a title-winning run in ${season}.`,
        score: clamp01(0.55 + Math.min(0.35, (champ.wins ?? 0) / 16)),
        metadata: {
          source: 'season_champion',
          wins: champ.wins ?? 0,
          losses: champ.losses ?? 0,
        },
      })
      registerWrite(resultRun.created, 'championshipRunsInducted')
    }
  }

  for (const [rosterId, titles] of championshipsByRoster) {
    if (titles < 2) continue
    const dynastyLength = scopedSeasonResults.filter(
      (row) => row.rosterId === rosterId && row.champion
    ).length
    const result = await createOrUpdateEntry({
      entityType: 'DYNASTY_RUN',
      entityId: rosterId,
      sport,
      leagueId: input.leagueId,
      category: 'longest_dynasties',
      title: `Dynasty Run — ${rosterId}`,
      summary: `${titles} championships across ${dynastyLength} title seasons in reviewed window.`,
      score: clamp01(0.45 + Math.min(0.45, titles * 0.12)),
      metadata: {
        source: 'season_result',
        championships: titles,
        dynastyLength,
      },
    })
    registerWrite(result.created, 'dynastiesInducted')
  }

  for (const rivalry of rivalryRecords.slice(0, 20)) {
    if ((rivalry.rivalryScore ?? 0) < 50) continue
    const result = await createOrUpdateEntry({
      entityType: 'MOMENT',
      entityId: `${rivalry.managerAId}:${rivalry.managerBId}`,
      sport,
      leagueId: input.leagueId,
      category: 'iconic_rivalries',
      title: `Iconic Rivalry — ${rivalry.managerAId} vs ${rivalry.managerBId}`,
      summary: `Rivalry tier ${rivalry.rivalryTier} with score ${Number(
        rivalry.rivalryScore ?? 0
      ).toFixed(1)}.`,
      score: clamp01(0.4 + Math.min(0.5, (rivalry.rivalryScore ?? 0) / 150)),
      metadata: {
        source: 'rivalry_record',
        managerAId: rivalry.managerAId,
        managerBId: rivalry.managerBId,
        rivalryScore: rivalry.rivalryScore,
        rivalryTier: rivalry.rivalryTier,
        firstDetectedAt: rivalry.firstDetectedAt,
      },
    })
    registerWrite(result.created, 'iconicRivalriesInducted')
  }

  const standingBySeasonTeam = new Map<string, number>()
  for (const standing of standingFacts) {
    if (!seasonSet.has(String(standing.season))) continue
    standingBySeasonTeam.set(
      `${standing.season}:${standing.teamId}`,
      typeof standing.rank === 'number' ? standing.rank : 999
    )
  }
  let upsetCount = 0
  let comebackCount = 0
  for (const matchup of matchupFacts) {
    if (matchup.season == null || !seasonSet.has(String(matchup.season))) continue
    if (!matchup.winnerTeamId) continue
    const loserTeamId = matchup.winnerTeamId === matchup.teamA ? matchup.teamB : matchup.teamA
    const winnerRank =
      standingBySeasonTeam.get(`${matchup.season}:${matchup.winnerTeamId}`) ?? 999
    const loserRank = standingBySeasonTeam.get(`${matchup.season}:${loserTeamId}`) ?? 999
    const rankGap = winnerRank - loserRank
    const margin = Math.abs(matchup.scoreA - matchup.scoreB)

    if (rankGap >= 4 && upsetCount < 20) {
      const result = await createOrUpdateEntry({
        entityType: 'MOMENT',
        entityId: matchup.matchupId,
        sport,
        leagueId: input.leagueId,
        season: String(matchup.season),
        category: 'biggest_upsets',
        title: `Big Upset — ${matchup.winnerTeamId} over ${loserTeamId}`,
        summary: `Rank gap ${rankGap} in season ${matchup.season}. Final margin ${margin.toFixed(1)}.`,
        score: clamp01(0.45 + Math.min(0.45, rankGap / 12)),
        metadata: {
          source: 'matchup_fact',
          matchupId: matchup.matchupId,
          winnerTeamId: matchup.winnerTeamId,
          loserTeamId,
          winnerRank,
          loserRank,
          margin,
        },
      })
      if (result.created) upsetCount += 1
    }

    if (margin <= 3 && matchup.scoreA + matchup.scoreB >= 80 && comebackCount < 20) {
      const result = await createOrUpdateEntry({
        entityType: 'MOMENT',
        entityId: `comeback:${matchup.matchupId}`,
        sport,
        leagueId: input.leagueId,
        season: String(matchup.season),
        category: 'historic_comebacks',
        title: `Historic Comeback Finish — ${matchup.winnerTeamId}`,
        summary: `Narrow high-scoring finish (${matchup.scoreA.toFixed(1)}-${matchup.scoreB.toFixed(
          1
        )}) in season ${matchup.season}.`,
        score: clamp01(0.4 + Math.min(0.4, (3 - margin) / 3 + (matchup.scoreA + matchup.scoreB) / 300)),
        metadata: {
          source: 'matchup_fact',
          matchupId: matchup.matchupId,
          winnerTeamId: matchup.winnerTeamId,
          scoreA: matchup.scoreA,
          scoreB: matchup.scoreB,
        },
      })
      if (result.created) comebackCount += 1
    }
  }

  return {
    entriesCreated: createdCounter.entriesCreated,
    entriesUpdated: createdCounter.entriesUpdated,
    momentsCreated: momentsSync.created,
    managersInducted: createdCounter.managersInducted,
    teamsInducted: createdCounter.teamsInducted,
    dynastiesInducted: createdCounter.dynastiesInducted,
    championshipRunsInducted: createdCounter.championshipRunsInducted,
    recordSeasonsInducted: createdCounter.recordSeasonsInducted,
    iconicRivalriesInducted: createdCounter.iconicRivalriesInducted,
  }
}
