import 'server-only'

import { prisma } from '@/lib/prisma'
import { TOKEN_ENTRY_TYPES } from './constants'
import { weekStartUtc, weeklyTokenSpend, type WeeklyTokenSpend } from './weeklyTokenSpend'

/**
 * The viewer's own spend and refund rows for the last `weeks` weeks (indexed on userId, createdAt),
 * folded into weekly totals. Null when the read fails — the Plans page then draws no chart rather
 * than an empty one that would read as "you spent nothing".
 */
export async function readWeeklyTokenSpend(userId: string, now = new Date(), weeks = 8): Promise<WeeklyTokenSpend[] | null> {
  const since = new Date(weekStartUtc(now).getTime() - (weeks - 1) * 7 * 24 * 60 * 60 * 1000)
  try {
    const rows = await prisma.tokenLedger.findMany({
      where: { userId, createdAt: { gte: since }, entryType: { in: [TOKEN_ENTRY_TYPES.SPEND, TOKEN_ENTRY_TYPES.REFUND] } },
      select: { createdAt: true, entryType: true, tokenDelta: true },
    })
    return weeklyTokenSpend(rows, now, weeks)
  } catch {
    return null
  }
}
