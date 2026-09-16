import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn()
const upsert = vi.fn()
const del = vi.fn()
const deleteMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      delete: (...args: unknown[]) => del(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}))

const { createSportsDataCacheTier } = await import('@/lib/sports-os/durableTier')

const FUTURE = new Date(Date.now() + 60_000)
const PAST = new Date(Date.now() - 60_000)
const envelope = { data: { wins: 7 }, fetchedAt: 1_700_000_000_000, source: 'live', staleAfterMs: 60_000 }

describe('sports-os durable tier (SportsDataCache)', () => {
  beforeEach(() => {
    findUnique.mockReset()
    upsert.mockReset()
    del.mockReset()
    deleteMany.mockReset()
  })

  it('returns a stored envelope with fetchedAt intact', async () => {
    findUnique.mockResolvedValue({ data: envelope, expiresAt: FUTURE })
    const entry = await createSportsDataCacheTier().read('k')
    expect(entry).toEqual(envelope)
  })

  it('reads a missing or expired row as a MISS, not an error', async () => {
    findUnique.mockResolvedValue(null)
    expect(await createSportsDataCacheTier().read('k')).toBeNull()

    findUnique.mockResolvedValue({ data: envelope, expiresAt: PAST })
    expect(await createSportsDataCacheTier().read('k')).toBeNull()
  })

  it('rejects a payload that is not one of our envelopes', async () => {
    // 🛑 SportsDataCache is a shared Json column — sports-router, the AI cache and the weather
    // geocode all write to it. A bare cast would hand the caller somebody else's payload and
    // render whatever sat at `fetchedAt` as an age.
    const tier = createSportsDataCacheTier()
    const notOurs = [
      { players: [1, 2, 3] },                                           // another writer's shape
      { data: 1, fetchedAt: 'yesterday', source: 'live', staleAfterMs: 1 }, // fetchedAt not a number
      { data: 1, fetchedAt: 1, source: 'made-up', staleAfterMs: 1 },    // unknown source
      { data: 1, fetchedAt: 1, source: 'live', staleAfterMs: 'soon' },  // TTL not a number or null
      { fetchedAt: 1, source: 'live', staleAfterMs: null },             // no `data` key at all
      [envelope],                                                        // an array
      'a string',
      null,
    ]
    for (const payload of notOurs) {
      findUnique.mockResolvedValue({ data: payload, expiresAt: FUTURE })
      expect(await tier.read('k'), JSON.stringify(payload)).toBeNull()
    }
  })

  it('accepts a null TTL, which is a legal envelope', async () => {
    // The guard must reject wrong SHAPES without rejecting a valid never-stale entry.
    findUnique.mockResolvedValue({ data: { ...envelope, staleAfterMs: null }, expiresAt: FUTURE })
    expect(await createSportsDataCacheTier().read('k')).toMatchObject({ staleAfterMs: null })
  })

  it('writes an entry whose row outlives its own staleness window', async () => {
    upsert.mockResolvedValue({})
    await createSportsDataCacheTier().write('k', envelope as never)

    const call = upsert.mock.calls[0][0]
    expect(call.where).toEqual({ cacheKey: 'k' })
    expect(call.create.data).toEqual(envelope)
    // The row must outlive the TTL, or stale-while-revalidate could never serve from this tier —
    // the row would be gone at exactly the moment it is wanted.
    expect(call.create.expiresAt.getTime() - Date.now()).toBeGreaterThan(envelope.staleAfterMs)
  })

  it('deletes by exact key, and by bounded prefix', async () => {
    del.mockResolvedValue({})
    deleteMany.mockResolvedValue({ count: 3 })
    const tier = createSportsDataCacheTier()

    await tier.remove?.('k')
    expect(del).toHaveBeenCalledWith({ where: { cacheKey: 'k' } })

    await tier.removePrefix?.('sos:sum:standings:v1:l=lg1&')
    expect(deleteMany).toHaveBeenCalledWith({
      where: { cacheKey: { startsWith: 'sos:sum:standings:v1:l=lg1&' } },
    })
  })

  it('swallows a delete for a row that is already gone', async () => {
    del.mockRejectedValue(new Error('Record to delete does not exist.'))
    await expect(createSportsDataCacheTier().remove?.('k')).resolves.toBeUndefined()
  })
})
