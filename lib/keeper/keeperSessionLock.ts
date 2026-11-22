import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Submissions and deadline defaults share one transaction lock per league season. */
export function withKeeperSessionLock<T>(
  leagueId: string,
  seasonId: string,
  action: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const key = JSON.stringify(['keeper-selection', leagueId, seasonId])
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    return action(db)
  }, { maxWait: 20_000, timeout: 60_000 })
}
