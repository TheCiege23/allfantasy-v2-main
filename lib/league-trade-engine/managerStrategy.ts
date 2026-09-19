import type { PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { ProposalManagerStrategy } from '@/lib/league-trade-engine/proposalSuggestions'

export const TRADE_MANAGER_STRATEGIES = ['win-now', 'balanced', 'rebuild'] as const

export function isTradeManagerStrategy(value: unknown): value is ProposalManagerStrategy {
  return typeof value === 'string' && TRADE_MANAGER_STRATEGIES.includes(value as ProposalManagerStrategy)
}

type StrategyStore = Pick<PrismaClient, 'tradeManagerStrategy'>

export async function getTradeManagerStrategy(
  leagueId: string,
  userId: string,
  db: StrategyStore = prisma,
): Promise<{ active: ProposalManagerStrategy; rosterId: string | null; confirmedAt: Date } | null> {
  const row = await db.tradeManagerStrategy.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { active: true, rosterId: true, confirmedAt: true },
  })
  if (!row || !isTradeManagerStrategy(row.active)) return null
  return { active: row.active, rosterId: row.rosterId, confirmedAt: row.confirmedAt }
}

export async function saveTradeManagerStrategy(input: {
  leagueId: string
  userId: string
  rosterId: string | null
  active: ProposalManagerStrategy
}, db: StrategyStore = prisma) {
  return db.tradeManagerStrategy.upsert({
    where: { leagueId_userId: { leagueId: input.leagueId, userId: input.userId } },
    create: {
      leagueId: input.leagueId,
      userId: input.userId,
      rosterId: input.rosterId,
      active: input.active,
      source: 'manager_confirmed',
      confirmedAt: new Date(),
    },
    update: {
      rosterId: input.rosterId,
      active: input.active,
      source: 'manager_confirmed',
      confirmedAt: new Date(),
    },
    select: { active: true, rosterId: true, confirmedAt: true },
  })
}
