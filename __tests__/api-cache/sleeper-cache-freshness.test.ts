/**
 * 🛑 A Sleeper trade offer could stay invisible on every trade screen for two cache windows
 * (2026-09-25). This layer kept each week's transactions five minutes, AND its provider fetch
 * carried `next: { revalidate: 60 }` — Next 14's stale-while-revalidate data cache — so the call
 * made to refresh an expired entry was often answered with the old response.
 *
 * These pin the repair: the provider fetch is `no-store`, and one reader can ask for fresher data
 * (`maxAgeMs`) without changing what anyone else accepts — measured against when the data was
 * FETCHED, including for a row read back from the DB cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: new Map<string, { data: unknown; expiresAt: Date }>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => h.rows.get(where.cacheKey) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        h.rows.set(where.cacheKey, { data: create.data, expiresAt: create.expiresAt })
        return { cacheKey: where.cacheKey }
      }),
      delete: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({})),
    },
  },
}))

const fetchMock = vi.fn()
const T0 = new Date('2026-09-25T15:00:00Z').getTime()
const FIVE_MIN = 5 * 60 * 1000

let n = 0
function answerWith(body: () => unknown) {
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => body() }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  h.rows.clear()
  fetchMock.mockReset()
  n = 0
  answerWith(() => [{ transaction_id: `tx${++n}`, type: 'trade', status: 'pending' }])
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function layer() {
  return import('@/lib/api-cache/SleeperCacheLayer')
}

describe('cold cache database reads', () => {
  it('reads a large player payload once for concurrent cold requests', async () => {
    const { prisma } = await import('@/lib/prisma')
    let complete!: (row: { data: unknown; expiresAt: Date }) => void
    vi.mocked(prisma.sportsDataCache.findUnique).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }) as never)
    const { getAllPlayers } = await layer()
    const requests = Array.from({ length: 20 }, () => getAllPlayers())
    expect(prisma.sportsDataCache.findUnique).toHaveBeenCalledTimes(1)
    complete({ data: { defender: { position: 'LB' } }, expiresAt: new Date(T0 + 24 * 60 * 60 * 1000) })
    const answers = await Promise.all(requests)
    expect(answers.every(answer => answer === answers[0])).toBe(true)
    expect(answers[0]).toEqual({ defender: { position: 'LB' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps strict freshness separate and does not downgrade memory after a delayed older read', async () => {
    const { prisma } = await import('@/lib/prisma')
    const row = { data: [{ transaction_id: 'old' }], expiresAt: new Date(T0 + 3 * 60 * 1000) }
    h.rows.set('transactions:L1:5', row)
    let complete!: (result: typeof row) => void
    vi.mocked(prisma.sportsDataCache.findUnique).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }) as never)
    const { getLeagueTransactions } = await layer()
    const lenient = getLeagueTransactions('L1', 5)
    expect((await getLeagueTransactions('L1', 5, { maxAgeMs: 45_000 }))[0]).toEqual(expect.objectContaining({ transaction_id: 'tx1' }))
    complete(row)
    expect((await lenient)[0]).toEqual({ transaction_id: 'old' })
    expect((await getLeagueTransactions('L1', 5))[0]).toEqual(expect.objectContaining({ transaction_id: 'tx1' }))
  })
  it('releases a failed shared request so the next caller can recover', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { getAllPlayers } = await layer()
    fetchMock.mockRejectedValueOnce(new Error('Provider unavailable'))
    const failures = await Promise.allSettled([getAllPlayers(), getAllPlayers()])
    expect(failures.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(prisma.sportsDataCache.findUnique).toHaveBeenCalledTimes(1)
    answerWith(() => ({ defender: { position: 'LB' } }))
    expect(await getAllPlayers()).toEqual({ defender: { position: 'LB' } })
    expect(prisma.sportsDataCache.findUnique).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('🛑 the provider fetch is not a second cache', () => {
  it('asks for no-store and never sets `next.revalidate`', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as RequestInit & { next?: unknown }
    expect(init.cache).toBe('no-store')
    expect(init.next).toBeUndefined()
  })
})

describe('maxAgeMs is ONE reader asking for fresher data', () => {
  it('[control] a plain read inside five minutes is served from memory', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    vi.setSystemTime(T0 + 4 * 60 * 1000)
    await getLeagueTransactions('L1', 5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('🛑 a 45 s reader refetches data a minute old — and sees the new offer', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    vi.setSystemTime(T0 + 60_000)
    const fresh = await getLeagueTransactions('L1', 5, { maxAgeMs: 45_000 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fresh[0] as { transaction_id: string }).transaction_id).toBe('tx2')
  })

  it('a 45 s reader inside 45 s is served from memory', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    vi.setSystemTime(T0 + 30_000)
    await getLeagueTransactions('L1', 5, { maxAgeMs: 45_000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a max age longer than the TTL does not stretch the TTL', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    vi.setSystemTime(T0 + FIVE_MIN + 1_000)
    await getLeagueTransactions('L1', 5, { maxAgeMs: 60 * 60 * 1000 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('🛑 a DB row is aged from when it was FETCHED, not from when this process read it', async () => {
    // Another instance wrote this two minutes ago: it expires in three.
    h.rows.set('transactions:L1:5', { data: [{ transaction_id: 'old' }], expiresAt: new Date(T0 + 3 * 60 * 1000) })
    const { getLeagueTransactions } = await layer()

    // [control] a plain reader still accepts it — nothing changed for anyone else.
    expect((await getLeagueTransactions('L1', 5))[0]).toEqual({ transaction_id: 'old' })
    expect(fetchMock).not.toHaveBeenCalled()

    // The plain read copied it into memory. A 45 s reader must still see it as two minutes old,
    // not as "fetched just now" — which is what stamping memory with the read time would say.
    const fresh = await getLeagueTransactions('L1', 5, { maxAgeMs: 45_000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fresh[0] as { transaction_id: string }).transaction_id).toBe('tx1')
  })

  it('a provider failure on a fresh read still falls back to the older data', async () => {
    const { getLeagueTransactions } = await layer()
    await getLeagueTransactions('L1', 5)
    vi.setSystemTime(T0 + 60_000)
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const out = await getLeagueTransactions('L1', 5, { maxAgeMs: 45_000 })
    expect((out[0] as { transaction_id: string }).transaction_id).toBe('tx1')
  })
})

describe('getSleeperState', () => {
  it('reads /state/<sport> for NFL and NBA, cached', async () => {
    answerWith(() => ({ week: 4, leg: 4, season_type: 'regular' }))
    const { getSleeperState } = await layer()
    expect(await getSleeperState('NFL')).toMatchObject({ leg: 4 })
    await getSleeperState('nfl')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/state\/nfl$/)
    await getSleeperState('NBA')
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/state\/nba$/)
  })

  it('answers null without a request for a sport Sleeper keeps no clock for', async () => {
    const { getSleeperState } = await layer()
    expect(await getSleeperState('MLB')).toBeNull()
    expect(await getSleeperState('SOCCER')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
