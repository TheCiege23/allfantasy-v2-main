import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Writes a season's schedule rows only if nobody else wrote them first.
 *
 * 🛑 CHECK-THEN-INSERT RACED AND DOUBLED SCHEDULES (2026-11-28). `ensureScheduleForNewSeason` counted
 * the season's matchups, then did several more reads (rosters, divisions, settings), then
 * `createMany` — with no lock. Draft completion can sync more than once at the same moment, and every
 * run that counted 0 wrote a full schedule. Seen on an NBA league: the viewer's scoreboard listed
 * "TheCiege26's Team vs Open Team 16" three times in one week, and every other pairing was tripled
 * further down. The same shape sat in the pre-league backfill.
 *
 * The fix takes a per-season transaction-scoped advisory lock, re-runs the caller's "already there?"
 * check under it, and only then inserts. A second runner waits for the first, sees its rows and
 * writes nothing.
 */
export async function createScheduleRowsOnce(args: {
  seasonId: string
  /** Under the lock: true when the rows this call would write already exist. */
  alreadyWritten: (tx: Prisma.TransactionClient) => Promise<boolean>
  rows: Prisma.RedraftMatchupCreateManyInput[]
}): Promise<{ created: number }> {
  if (args.rows.length === 0) return { created: 0 }
  return prisma.$transaction(
    async (tx) => {
      // pg_advisory_xact_lock returns void, which Prisma cannot deserialize: $executeRaw, not $queryRaw.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`redraft-schedule:${args.seasonId}`}, 0))`
      if (await args.alreadyWritten(tx)) return { created: 0 }
      const res = await tx.redraftMatchup.createMany({ data: args.rows })
      return { created: res.count }
    },
    { timeout: 30_000, maxWait: 30_000 },
  )
}
