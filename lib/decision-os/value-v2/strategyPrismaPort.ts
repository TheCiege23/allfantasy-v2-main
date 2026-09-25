import type { Prisma, PrismaClient } from '@prisma/client'
import type { StrategyStorePort } from './strategyStore'

/** Isolates the store from singleton/environment selection; integration tests inject the verified test client. */
export function createStrategyPrismaPort(prisma: PrismaClient, dbNull: Prisma.NullTypes.DbNull): StrategyStorePort {
  return {
    read: scope => prisma.decisionStrategyState.findUnique({ where: { userId_leagueId_season: scope } }),
    initialize: async scope => {
      try { return await prisma.decisionStrategyState.upsert({
        where: { userId_leagueId_season: scope }, create: { ...scope, active: 'balanced' }, update: {},
      }) } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error
        return prisma.decisionStrategyState.findUniqueOrThrow({ where: { userId_leagueId_season: scope } })
      }
    },
    commit: ({ scope, previous, next, action, evidenceId }) => prisma.$transaction(async tx => {
      const result = await tx.decisionStrategyState.updateMany({
        where: { id: previous.id, ...scope, revision: previous.revision },
        data: { active: next.active, revision: next.revision, lastObservedWeek: next.lastObservedWeek,
          pending: next.pending === null ? dbNull : next.pending },
      })
      if (result.count !== 1) return false
      await tx.decisionStrategyEvent.create({ data: {
        stateId: previous.id, ...scope, revision: next.revision, action, evidenceId,
        before: { active: previous.active, pending: previous.pending, lastObservedWeek: previous.lastObservedWeek },
        after: { active: next.active, pending: next.pending, lastObservedWeek: next.lastObservedWeek },
      } })
      return true
    }),
  }
}
