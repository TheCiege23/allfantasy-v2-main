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

/** Bracket staging only. The caller supplies an isolated transaction for league and roster setup. */
export async function upsertChimmyStagingLeagueFixture(
  tx: Prisma.TransactionClient,
  data: Prisma.LeagueUncheckedCreateInput & { id: string; tenantId: string },
  rules: Prisma.LeagueUncheckedUpdateInput,
) {
  if (process.env.CHIMMY_STAGING_PROJECT_ID !== 'b3cd0239-9cb1-4c22-9d76-533d91d26f36' ||
      data.userId !== 'bracket-qa-admin' || data.tenantId !== 'chimmy-release-3164-rules-fixture-tenant' ||
      !['chimmy-3164-qa-points', 'chimmy-3164-qa-categories'].includes(data.id)) {
    throw new Error('Isolated Chimmy staging fixture scope required')
  }
  const account = await tx.appUser.findFirst({ where: { id: data.userId }, select: { email: true } })
  if (account?.email !== 'bracket-admin@staging.invalid') throw new Error('Wrong staging QA identity')
  const existing = await tx.league.findFirst({ where: { id: data.id }, select: { userId: true, tenantId: true } })
  if (existing && (existing.userId !== data.userId || existing.tenantId !== data.tenantId)) {
    throw new Error('Fixture ownership mismatch')
  }
  return tx.league.upsert({ where: { id: data.id }, update: rules, create: data })
}
