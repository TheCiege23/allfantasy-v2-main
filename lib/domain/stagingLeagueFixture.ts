import type { Prisma, PrismaClient } from '@prisma/client'
import type { ActorContext } from './actorContext'

/** Test harness only: provision a separately owned staging tenant and its league atomically. */
export async function createStagingLeagueFixture(db: PrismaClient, actor: ActorContext,
  data: Omit<Prisma.LeagueUncheckedCreateInput, 'tenantId' | 'userId'>) {
  if (process.env.NODE_ENV !== 'test' ||
      !new URL(process.env.DATABASE_URL || 'https://invalid').hostname.includes('winter-salad') ||
      !actor.tenantId.startsWith('pirate-capture-') || !actor.userId.trim()) {
    throw new Error('An explicitly scoped Pirate staging fixture actor and database are required.')
  }
  return db.$transaction(async tx => {
    await tx.tenant.create({ data: { id: actor.tenantId, slug: actor.tenantId, name: actor.tenantId } })
    return tx.league.create({ data: { ...data, tenantId: actor.tenantId, userId: actor.userId } })
  })
}
