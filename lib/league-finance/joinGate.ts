import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getOrCreateLeagueFinance, resolveSeasonForLeague } from '@/lib/league-finance/leagueFinanceService'
import { isLeagueEntryFeeProcessingEnabled } from '@/lib/monetization/leagueEntryFeeKillSwitch'

type Db = Prisma.TransactionClient | typeof prisma

function dbClient(tx?: Prisma.TransactionClient): Db {
  return tx ?? prisma
}

export type PaidJoinGateResult =
  | { ok: true }
  | { ok: false; code: 'PAYMENT_REQUIRED' | 'LEAGUE_NOT_FOUND'; message: string }

/**
 * Blocks roster creation for paid leagues until dues are paid or waived.
 * Call inside the same transaction as roster create when `tx` is passed.
 */
export async function assertPaidJoinAllowed(params: {
  leagueId: string
  userId: string
  tx?: Prisma.TransactionClient
}): Promise<PaidJoinGateResult> {
  /*
   * 🛑 WHILE AllFantasy HOLDS NO LEAGUE MONEY, NOBODY CAN PAY IT, SO NOBODY MAY BE BLOCKED FOR NOT PAYING
   * IT. With checkout off, this gate turned every "paid" league unjoinable unless the commissioner marked
   * each manager paid by hand. Dues are collected by the league itself and tracked in the dues tracker.
   */
  if (!isLeagueEntryFeeProcessingEnabled()) return { ok: true }
  const db = dbClient(params.tx)
  const finance = await getOrCreateLeagueFinance(params.leagueId, params.tx)
  if (!finance) {
    return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found' }
  }
  if (!finance.isPaidLeague || finance.entryFeeCents <= 0) {
    return { ok: true }
  }

  const season = await resolveSeasonForLeague(params.leagueId, params.tx)
  const dues = await (db as typeof prisma).leagueDues.findUnique({
    where: {
      leagueId_userId_season: {
        leagueId: params.leagueId,
        userId: params.userId,
        season,
      },
    },
    select: { status: true },
  })

  if (dues?.status === 'paid' || dues?.status === 'waived') {
    return { ok: true }
  }

  return {
    ok: false,
    code: 'PAYMENT_REQUIRED',
    message: 'This league requires a paid entry before joining. Complete payment from the league Finance tab or invite link.',
  }
}

/**
 * After a roster is created, attach `rosterId` to the season dues row if present.
 */
export async function linkDuesToRoster(params: {
  leagueId: string
  userId: string
  rosterId: string
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const db = dbClient(params.tx)
  const season = await resolveSeasonForLeague(params.leagueId, params.tx)
  await db.leagueDues.updateMany({
    where: {
      leagueId: params.leagueId,
      userId: params.userId,
      season,
    },
    data: { rosterId: params.rosterId },
  })
}
