/**
 * Multi-sport stat ingestion service for schedule/stats pipeline.
 * Handles ingestion jobs, payload normalization, and fantasy point pre-computation.
 */
import { prisma } from '@/lib/prisma'
import { normalizeStatPayload } from './StatNormalizationService'
import { computeFantasyPoints } from '@/lib/scoring-defaults/FantasyPointCalculator'
import type { PlayerStatsRecord } from '@/lib/scoring-defaults/types'
import { getLeagueScoringRules, getScoringTemplate } from '@/lib/multi-sport/ScoringTemplateResolver'
import { toSportType, type SportType } from '@/lib/multi-sport/sport-types'
import { upsertGameSchedule, type GameScheduleInput } from './ScheduleIngestionService'

const UPSERT_CHUNK_SIZE = 100

function chunkRows<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export interface PlayerGameStatIngestInput {
  playerId: string
  gameId: string
  statPayload: Record<string, number>
}

export interface TeamGameStatIngestInput {
  teamId: string
  gameId: string
  statPayload: Record<string, number>
}

export interface IngestSportStatsInput {
  sportType: SportType | string
  season: number
  weekOrRound: number
  source: string
  leagueId?: string
  formatType?: string
  schedules?: GameScheduleInput[]
  playerStats?: PlayerGameStatIngestInput[]
  teamStats?: TeamGameStatIngestInput[]
}

export interface IngestSportStatsResult {
  jobId: string
  gameCount: number
  playerStatCount: number
  teamStatCount: number
}

async function resolveRulesForIngestion(
  sportType: SportType,
  leagueId?: string,
  formatType?: string
) {
  if (leagueId) {
    return getLeagueScoringRules(leagueId, sportType, formatType ?? 'standard')
  }
  const template = await getScoringTemplate(sportType, formatType ?? 'standard')
  return template.rules
}

export async function startStatIngestionJob(
  sportType: SportType | string,
  season: number,
  source: string,
  weekOrRound?: number
): Promise<string> {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const job = await prisma.statIngestionJob.create({
    data: {
      sportType: sport,
      season,
      weekOrRound,
      source,
      status: 'running',
    },
    select: { id: true },
  })
  return job.id
}

export async function completeStatIngestionJob(
  jobId: string,
  updates: {
    status: 'completed' | 'failed'
    gameCount: number
    statCount: number
    errorMessage?: string
  }
): Promise<void> {
  await prisma.statIngestionJob.update({
    where: { id: jobId },
    data: {
      status: updates.status,
      gameCount: updates.gameCount,
      statCount: updates.statCount,
      errorMessage: updates.errorMessage ?? null,
      completedAt: new Date(),
    },
  })
}

/**
 * Ingest schedules and game stats for one sport/period.
 * Normalizes payload keys and pre-computes sport-aware fantasy points for fast reads.
 */
export async function ingestSportStats(
  input: IngestSportStatsInput
): Promise<IngestSportStatsResult> {
  const sport = toSportType(typeof input.sportType === 'string' ? input.sportType : input.sportType)
  const schedules = input.schedules ?? []
  const playerStats = input.playerStats ?? []
  const teamStats = input.teamStats ?? []
  const jobId = await startStatIngestionJob(sport, input.season, input.source, input.weekOrRound)

  try {
    const rules = await resolveRulesForIngestion(sport, input.leagueId, input.formatType)

    for (const game of schedules) {
      await upsertGameSchedule({
        ...game,
        sportType: sport,
        season: input.season,
        weekOrRound: input.weekOrRound,
      })
    }

    // Normalization/fantasy-point math is precomputed, then upserts run in chunked
    // transactions instead of one awaited round-trip per row — a full NFL week is ~1,500
    // player rows, and sequential upserts over a pooled connection cannot fit a multi-week
    // backfill inside a 300s function budget. Same upserts, same semantics, batched.
    const preparedPlayerStats = playerStats.map((row) => {
      const normalized = normalizeStatPayload(sport, row.statPayload)
      return {
        row,
        normalized,
        fantasyPoints: computeFantasyPoints(normalized as PlayerStatsRecord, rules),
      }
    })

    for (const batch of chunkRows(preparedPlayerStats, UPSERT_CHUNK_SIZE)) {
      await prisma.$transaction(
        batch.map(({ row, normalized, fantasyPoints }) =>
          prisma.playerGameStat.upsert({
            where: {
              playerId_sportType_gameId: {
                playerId: row.playerId,
                sportType: sport,
                gameId: row.gameId,
              },
            },
            update: {
              season: input.season,
              weekOrRound: input.weekOrRound,
              statPayload: row.statPayload,
              normalizedStatMap: normalized,
              fantasyPoints,
              updatedAt: new Date(),
            },
            create: {
              playerId: row.playerId,
              sportType: sport,
              gameId: row.gameId,
              season: input.season,
              weekOrRound: input.weekOrRound,
              statPayload: row.statPayload,
              normalizedStatMap: normalized,
              fantasyPoints,
            },
            // RETURNING trimmed to id: callers ignore the row, and selecting every column
            // breaks against a DB whose table lags schema.prisma (P2022) — which prod's
            // player_game_stats did until the provider-telemetry migration.
            select: { id: true },
          })
        )
      )
    }

    for (const batch of chunkRows(teamStats, UPSERT_CHUNK_SIZE)) {
      await prisma.$transaction(
        batch.map((row) =>
          prisma.teamGameStat.upsert({
            where: {
              sportType_gameId_teamId: {
                sportType: sport,
                gameId: row.gameId,
                teamId: row.teamId,
              },
            },
            update: {
              season: input.season,
              weekOrRound: input.weekOrRound,
              statPayload: row.statPayload,
              updatedAt: new Date(),
            },
            create: {
              sportType: sport,
              gameId: row.gameId,
              teamId: row.teamId,
              season: input.season,
              weekOrRound: input.weekOrRound,
              statPayload: row.statPayload,
            },
            select: { id: true },
          })
        )
      )
    }

    await completeStatIngestionJob(jobId, {
      status: 'completed',
      gameCount: schedules.length,
      statCount: playerStats.length + teamStats.length,
    })

    return {
      jobId,
      gameCount: schedules.length,
      playerStatCount: playerStats.length,
      teamStatCount: teamStats.length,
    }
  } catch (error) {
    await completeStatIngestionJob(jobId, {
      status: 'failed',
      gameCount: schedules.length,
      statCount: playerStats.length + teamStats.length,
      errorMessage: error instanceof Error ? error.message : 'Unknown stat ingestion error',
    })
    throw error
  }
}
