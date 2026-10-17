import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** One lock and transaction for automatic setup, manual setup, and individual setup actions. */
export function withSurvivorSetupTransaction<T>(leagueId: string, work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    return work(db)
  }, { timeout: 30_000, maxWait: 10_000 })
}
