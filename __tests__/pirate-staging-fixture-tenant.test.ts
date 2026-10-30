import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActorContext } from '@/lib/domain/actorContext'
import { createStagingLeagueFixture } from '@/lib/domain/stagingLeagueFixture'

afterEach(() => vi.unstubAllEnvs())
const actor = createActorContext({ userId: 'fixture-owner', tenantId: 'pirate-capture-test', actorLabel: 'Capture QA' })
if (!actor.ok) throw new Error('Fixture actor must be valid')
const context = actor.value
const data = { platform: 'manual', platformLeagueId: 'fixture', name: 'Fixture' }
function database() {
  const tx = { tenant: { create: vi.fn() }, league: { create: vi.fn().mockResolvedValue({ id: 'league' }) } }
  const db = { $transaction: vi.fn(async callback => callback(tx)) }
  return { tx, db }
}

describe('tenant-scoped Pirate staging fixture', () => {
  it('writes the validated actor tenant and owner even if untyped input attempts an override', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'postgresql://fixture@ep-winter-salad-fixture.neon.tech/qa')
    const { db, tx } = database()
    await createStagingLeagueFixture(db as never, context, { ...data, tenantId: 'wrong-tenant', userId: 'wrong-owner' } as never)
    expect(tx.tenant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: context.tenantId }) })
    expect(tx.league.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: context.tenantId, userId: context.userId }) })
  })

  it.each([
    ['production', 'postgresql://fixture@ep-winter-salad-fixture.neon.tech/qa'],
    ['test', 'postgresql://fixture@ep-production.neon.tech/app'],
  ])('refuses fixture writes outside isolated staging (%s)', async (environment, url) => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('DATABASE_URL', url)
    const { db } = database()
    await expect(createStagingLeagueFixture(db as never, context, data)).rejects.toThrow('explicitly scoped')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
