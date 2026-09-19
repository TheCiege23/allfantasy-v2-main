import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const WAREHOUSE_FACT_BATCH_SIZE = 250

export interface SeasonStandingFactWrite {
  leagueId: string
  sport: string
  season: number
  teamId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  rank: number | null
}

async function persistWithIsolation<T>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>,
  weight: (batch: T[]) => number = (batch) => batch.length,
): Promise<number> {
  if (rows.length === 0) return 0
  try {
    await write(rows)
    return weight(rows)
  } catch {
    if (rows.length === 1) return 0
    const midpoint = Math.ceil(rows.length / 2)
    const left = await persistWithIsolation(rows.slice(0, midpoint), write, weight)
    const right = await persistWithIsolation(rows.slice(midpoint), write, weight)
    return left + right
  }
}

/** Upserts a season's standings in one bounded statement while isolating malformed rows. */
export async function persistSeasonStandingFacts(rows: SeasonStandingFactWrite[]): Promise<number> {
  let written = 0
  for (let offset = 0; offset < rows.length; offset += WAREHOUSE_FACT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + WAREHOUSE_FACT_BATCH_SIZE)
    written += await persistWithIsolation(batch, async (isolatedBatch) => {
      const values = isolatedBatch.map((row) => Prisma.sql`(
        ${randomUUID()}, ${row.leagueId}, ${row.sport}, ${row.season}, ${row.teamId},
        ${row.wins}, ${row.losses}, ${row.ties}, ${row.pointsFor}, ${row.pointsAgainst},
        ${row.rank}, NOW()
      )`)
      await prisma.$executeRaw`
        INSERT INTO "dw_season_standing_facts" (
          "standingId", "leagueId", "sport", "season", "teamId", "wins", "losses",
          "ties", "pointsFor", "pointsAgainst", "rank", "createdAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("leagueId", "season", "teamId")
        DO UPDATE SET
          "wins" = EXCLUDED."wins",
          "losses" = EXCLUDED."losses",
          "ties" = EXCLUDED."ties",
          "pointsFor" = EXCLUDED."pointsFor",
          "pointsAgainst" = EXCLUDED."pointsAgainst",
          "rank" = EXCLUDED."rank"
      `
    })
  }
  return written
}

export interface ImmutableTransactionFactWrite {
  transactionId: string
  leagueId: string
  sport: string
  type: string
  playerId: string | null
  managerId: string | null
  rosterId: string | null
  payload: Record<string, unknown>
  season: number | null
  weekOrPeriod: number | null
  createdAt?: Date
}

/** Inserts immutable provider observations in bounded batches; replayed ids remain no-ops. */
export async function persistImmutableTransactionFacts(
  rows: ImmutableTransactionFactWrite[],
): Promise<number> {
  let written = 0
  for (let offset = 0; offset < rows.length; offset += WAREHOUSE_FACT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + WAREHOUSE_FACT_BATCH_SIZE)
    written += await persistWithIsolation(batch, async (isolatedBatch) => {
      const values = isolatedBatch.map((row) => Prisma.sql`(
        ${row.transactionId}, ${row.leagueId}, ${row.sport}, ${row.type},
        ${row.playerId}, ${row.managerId}, ${row.rosterId},
        ${JSON.stringify(row.payload)}::jsonb, ${row.season}, ${row.weekOrPeriod},
        ${row.createdAt ?? new Date()}
      )`)
      await prisma.$executeRaw`
        INSERT INTO "dw_transaction_facts" (
          "transactionId", "leagueId", "sport", "type", "playerId", "managerId",
          "rosterId", "payload", "season", "weekOrPeriod", "createdAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("transactionId") DO NOTHING
      `
    })
  }
  return written
}

/** Upserts the latest form of mutable facts while keeping the newest duplicate in a feed. */
export async function persistMutableTransactionFacts(
  rows: ImmutableTransactionFactWrite[],
): Promise<number> {
  const deduplicated = new Map<string, { row: ImmutableTransactionFactWrite; inputCount: number }>()
  for (const row of rows) {
    const previous = deduplicated.get(row.transactionId)
    deduplicated.set(row.transactionId, {
      row,
      inputCount: (previous?.inputCount ?? 0) + 1,
    })
  }
  const entries = [...deduplicated.values()]

  let written = 0
  for (let offset = 0; offset < entries.length; offset += WAREHOUSE_FACT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + WAREHOUSE_FACT_BATCH_SIZE)
    written += await persistWithIsolation(
      batch,
      async (isolatedBatch) => {
        const values = isolatedBatch.map(({ row }) => Prisma.sql`(
          ${row.transactionId}, ${row.leagueId}, ${row.sport}, ${row.type},
          ${row.playerId}, ${row.managerId}, ${row.rosterId},
          ${JSON.stringify(row.payload)}::jsonb, ${row.season}, ${row.weekOrPeriod},
          ${row.createdAt ?? new Date()}
        )`)
        await prisma.$executeRaw`
          INSERT INTO "dw_transaction_facts" (
            "transactionId", "leagueId", "sport", "type", "playerId", "managerId",
            "rosterId", "payload", "season", "weekOrPeriod", "createdAt"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("transactionId")
          DO UPDATE SET
            "leagueId" = EXCLUDED."leagueId",
            "sport" = EXCLUDED."sport",
            "type" = EXCLUDED."type",
            "playerId" = EXCLUDED."playerId",
            "managerId" = EXCLUDED."managerId",
            "rosterId" = EXCLUDED."rosterId",
            "payload" = EXCLUDED."payload",
            "season" = EXCLUDED."season",
            "weekOrPeriod" = EXCLUDED."weekOrPeriod"
        `
      },
      (successfulBatch) => successfulBatch.reduce((sum, entry) => sum + entry.inputCount, 0),
    )
  }
  return written
}
