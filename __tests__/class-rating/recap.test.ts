// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  newest: null as number | null,
  rows: [] as unknown[],
  cache: new Map<string, unknown>(),
  sinceSeen: [] as number[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('max(season * 100 + week)')) return [{ period: db.newest }]
      // The grouped recap query: remember which period it summed after.
      db.sinceSeen.push(values[values.length - 1] as number)
      return db.rows
    }),
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) =>
        db.cache.has(where.cacheKey) ? { data: db.cache.get(where.cacheKey) } : null,
      ),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        db.cache.set(where.cacheKey, create.data)
        return {}
      }),
    },
  },
}))

const dispatch = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

import { RECAP_STATE_KEY, drainClassRecaps, queueClassRecaps, recapFor } from '@/lib/class-rating/recap'

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  delta: 14.4,
  w: 1,
  l: 0,
  t: 0,
  apWins: 9,
  apGames: 11,
  established: true,
  classLevel: 17,
  division: 4,
  rating: 1561.7,
  rd: 58.2,
  ...over,
})

beforeEach(() => {
  db.newest = null
  db.rows = []
  db.cache = new Map()
  db.sinceSeen = []
  dispatch.mockClear()
  vi.unstubAllEnvs()
})

describe('recapFor — the message', () => {
  it('leads with the move and states the Class, all-play and head-to-head behind it', () => {
    const r = recapFor(row())
    expect(r.title).toBe('Your Class rating is up 14 this week')
    expect(r.body).toContain('You outscored 9 of 11 teams across your leagues (1-0 head-to-head), +14 rating.')
    expect(r.body).toContain('Now Class 17 · Division 4, rating 1562 ±58.')
  })

  it('says "slipped" for a drop — and a head-to-head WIN can sit beside one, because the rating is all-play', () => {
    const r = recapFor(row({ delta: -9, w: 1, apWins: 2, apGames: 11 }))
    expect(r.title).toBe('Your Class rating slipped 9 this week')
    expect(r.body).toContain('You outscored 2 of 11 teams across your leagues (1-0 head-to-head), −9 rating.')
  })

  it('never names a Class for a provisional rating', () => {
    const r = recapFor(row({ established: false, classLevel: null, division: null }))
    expect(r.body).toContain('Still provisional — rating 1562 ±58.')
    expect(r.body).not.toMatch(/Class \d/)
  })
})

describe('queueClassRecaps', () => {
  it('🛑 the first run only records where it starts — a whole career is not "this week"', async () => {
    db.newest = 202603
    db.rows = [row()]
    const out = await queueClassRecaps()
    expect(out).toMatchObject({ baseline: 1, queued: 0 })
    expect(db.cache.get(RECAP_STATE_KEY)).toMatchObject({ lastPeriod: 202603 })
    expect(db.sinceSeen).toEqual([])
  })

  it('queues one recap per manager for weeks rated since the marker, then moves it', async () => {
    db.cache.set(RECAP_STATE_KEY, { lastPeriod: 202602, queue: null })
    db.newest = 202603
    db.rows = [row(), row({ userId: 'u2', delta: -3 })]
    const out = await queueClassRecaps()
    expect(out.queued).toBe(2)
    expect(db.sinceSeen).toEqual([202602])
    expect(db.cache.get(RECAP_STATE_KEY)).toMatchObject({ lastPeriod: 202603, queue: { period: 202603, sent: 0, failed: 0 } })
  })

  it('a rebuild that rated no new week queues nothing', async () => {
    db.cache.set(RECAP_STATE_KEY, { lastPeriod: 202603, queue: null })
    db.newest = 202603
    expect((await queueClassRecaps()).queued).toBe(0)
    expect(db.sinceSeen).toEqual([])
  })
})

describe('drainClassRecaps', () => {
  const queued = () =>
    db.cache.set(RECAP_STATE_KEY, {
      lastPeriod: 202603,
      queue: { period: 202603, pending: [recapFor(row()), recapFor(row({ userId: 'u2' })), recapFor(row({ userId: 'u3' }))], sent: 0, failed: 0 },
    })

  it('🛑 sends NOTHING unless CLASS_RECAP_NOTIFICATIONS=true — it notifies real people', async () => {
    queued()
    expect(await drainClassRecaps()).toMatchObject({ sent: 0 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('sends a batch, records it, and leaves the rest for the next fire', async () => {
    vi.stubEnv('CLASS_RECAP_NOTIFICATIONS', 'true')
    queued()
    const out = await drainClassRecaps(new Date(), 2)
    expect(out).toMatchObject({ sent: 2, failed: 0, remaining: 1 })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u1'], category: 'matchup_results', actionHref: '/core/rankings?scope=class', dedupePrefix: 'class-recap:202603' }),
    )
    expect(db.cache.get(RECAP_STATE_KEY)).toMatchObject({ queue: { pending: [expect.objectContaining({ userId: 'u3' })], sent: 2 } })
  })
})
