import { prisma } from '@/lib/prisma'
import type { LeaguePlayerWeeklyScoreCandidateRow, LeaguePlayerWeeklyScoreWriterAdapter } from '@/lib/scoring/league-player-weekly-score-store'

const EPS_SKIP = 0.01

function candidateWhereKey(row: LeaguePlayerWeeklyScoreCandidateRow) {
  return {
    leagueId_playerId_week_season_sport: {
      leagueId: row.leagueId,
      playerId: row.playerId,
      week: row.week,
      season: row.season,
      sport: row.sport,
    },
  }
}

function keyForRow(row: {
  leagueId: string
  playerId: string
  week: number
  season: number
  sport: string
}): string {
  return `${row.leagueId}\0${row.playerId}\0${row.season}\0${row.week}\0${row.sport}`
}

export class PrismaLeaguePlayerWeeklyScoreAdapter implements LeaguePlayerWeeklyScoreWriterAdapter {
  async upsertMany(rows: LeaguePlayerWeeklyScoreCandidateRow[]): Promise<{
    wroteRows: number
    writtenCreate: number
    writtenUpdate: number
    skipped: number
  }> {
    if (rows.length === 0) {
      return { wroteRows: 0, writtenCreate: 0, writtenUpdate: 0, skipped: 0 }
    }

    const uniqueRows = [...new Map(rows.map((row) => [keyForRow(row), row])).values()]
    const existingRows = await prisma.leaguePlayerWeeklyScore.findMany({
      where: {
        OR: uniqueRows.map((row) => ({
          leagueId: row.leagueId,
          playerId: row.playerId,
          season: row.season,
          week: row.week,
          sport: row.sport,
        })),
      },
      select: {
        leagueId: true,
        playerId: true,
        season: true,
        week: true,
        sport: true,
        fantasyPts: true,
        isFinalized: true,
      },
    })
    const existingByKey = new Map(existingRows.map((row) => [keyForRow(row), row]))

    let writtenCreate = 0
    let writtenUpdate = 0
    let skipped = 0

    await prisma.$transaction(async (tx) => {
      for (const row of uniqueRows) {
        const key = keyForRow(row)
        const existing = existingByKey.get(key)
        const preserveFinalized = Boolean(existing?.isFinalized)
        const shouldFinalize = preserveFinalized || row.isFinalized
        const canSkip =
          existing != null &&
          Math.abs(Number(existing.fantasyPts ?? 0) - row.fantasyPts) <= EPS_SKIP &&
          Boolean(existing.isFinalized) === shouldFinalize

        if (canSkip) {
          skipped += 1
          continue
        }

        await tx.leaguePlayerWeeklyScore.upsert({
          where: candidateWhereKey(row),
          create: {
            leagueId: row.leagueId,
            playerId: row.playerId,
            season: row.season,
            week: row.week,
            sport: row.sport,
            fantasyPts: row.fantasyPts,
            stats: row.stats ?? undefined,
            isFinalized: row.isFinalized,
            source: row.source,
            lineageJobName: row.lineageJobName ?? undefined,
            rollupVersion: row.rollupVersion ?? undefined,
            scoringProfileId: row.scoringProfileId ?? undefined,
            scoringRulesHash: row.scoringRulesHash ?? undefined,
          },
          update: {
            fantasyPts: row.fantasyPts,
            stats: row.stats ?? undefined,
            isFinalized: shouldFinalize,
            source: row.source,
            lineageJobName: row.lineageJobName ?? undefined,
            rollupVersion: row.rollupVersion ?? undefined,
            scoringProfileId: row.scoringProfileId ?? undefined,
            scoringRulesHash: row.scoringRulesHash ?? undefined,
          },
        })

        if (existing) writtenUpdate += 1
        else writtenCreate += 1
      }
    })

    return {
      wroteRows: writtenCreate + writtenUpdate,
      writtenCreate,
      writtenUpdate,
      skipped,
    }
  }
}

