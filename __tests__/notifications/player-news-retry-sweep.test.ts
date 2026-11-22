// @vitest-environment node
/**
 * The pending player-news sweep stamps `notificationDispatchedAt` only for TERMINAL outcomes. A
 * retryable one — an identity the registry cannot bind yet, a roster lookup that failed, a dispatch
 * that threw — stays unstamped so the next sweep tries again, up to MAX_DISPATCH_ATTEMPTS.
 *
 * The attempt ledger (playerNewsAttemptLedger) and the repeat guard (playerNewsRepeatGuard) both live
 * in `sportsDataCache`, so this runs them for real against an in-memory table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  newsUpdate: vi.fn(),
  rosterFind: vi.fn(),
  dispatch: vi.fn(),
  classify: vi.fn(),
  followers: vi.fn(),
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  upsertFails: false,
}))

const REGISTRY = [
  { id: 'pim-gibbs', canonicalName: 'Jahmyr Gibbs', position: 'RB', currentTeam: 'DET', sleeperId: '9221' },
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    redraftRosterPlayer: { findMany: h.rosterFind },
    playerIdentityMap: {
      findMany: async ({ where }: { where: { OR: Array<{ canonicalName?: { contains: string } }> } }) =>
        REGISTRY.filter((p) => where.OR.some((c) => c.canonicalName && p.canonicalName.toLowerCase().includes(c.canonicalName.contains.toLowerCase()))),
    },
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => h.cache.get(where.cacheKey) ?? null,
      findMany: async ({ where }: { where: { cacheKey: { in: string[] }; expiresAt: { gt: Date } } }) =>
        [...h.cache].filter(([k, v]) => where.cacheKey.in.includes(k) && v.expiresAt > where.expiresAt.gt).map(([cacheKey]) => ({ cacheKey })),
      upsert: async ({ where, create, update }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date }; update: { data: unknown; expiresAt: Date } }) => {
        if (h.upsertFails) throw new Error('cache down')
        h.cache.set(where.cacheKey, h.cache.has(where.cacheKey) ? { ...update } : { data: create.data, expiresAt: create.expiresAt })
      },
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        for (const r of data) if (!h.cache.has(r.cacheKey)) h.cache.set(r.cacheKey, { data: r.data, expiresAt: r.expiresAt })
        return { count: data.length }
      },
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: h.classify }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayerIdentity: h.followers }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { MAX_DISPATCH_ATTEMPTS } from '@/lib/notifications/playerNewsAttemptLedger'

const ROW = {
  id: 'news-1',
  sport: 'NFL',
  playerName: 'Jahmyr Gibbs',
  team: 'DET',
  headline: 'Gibbs (hamstring) ruled out Sunday',
  body: null,
  impact: 'medium',
}
const roster = (ownerId: string, leagueId: string) => ({ playerName: 'Jahmyr Gibbs', team: 'DET', sport: 'NFL', roster: { ownerId, leagueId } })

/** Ids stamped by the sweep's closing updateMany, across every sweep in the test. */
const stampedIds = () => h.newsUpdate.mock.calls.flatMap((c) => c[0].where.id.in as string[])
const ledger = (id = 'news-1') => h.cache.get(`player-news-dispatch:${id}`)?.data as { attempts: number; lastOutcome: string } | undefined
const leagueCalls = () => h.dispatch.mock.calls.map((c) => c[0]).filter((p) => p.leagueId)

beforeEach(() => {
  for (const f of [h.newsFind, h.newsUpdate, h.rosterFind, h.dispatch, h.classify, h.followers]) f.mockReset()
  h.cache.clear()
  h.upsertFails = false
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  h.classify.mockReturnValue('injury')
  h.rosterFind.mockResolvedValue([])
  h.followers.mockResolvedValue([])
})

describe('terminal outcomes are stamped, as before', () => {
  it('a delivered story', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-a', 'lg-a')])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ notified: 1, retryScheduled: 0, scanned: 1 })
    expect(stampedIds()).toEqual(['news-1'])
    expect(ledger()?.lastOutcome).toBe('delivered')
  })

  it('a policy skip', async () => {
    h.classify.mockReturnValue('player_news')
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out.retryScheduled).toBe(0)
    expect(stampedIds()).toEqual(['news-1'])
    expect(ledger()?.lastOutcome).toBe('policy-skipped')
  })

  it('nobody rosters or follows him', async () => {
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ noRoster: 1, retryScheduled: 0 })
    expect(stampedIds()).toEqual(['news-1'])
  })
})

describe('retryable outcomes stay unstamped', () => {
  it('🛑 a FAILED roster lookup is retried, not reported as "nobody rosters him"', async () => {
    h.rosterFind.mockRejectedValueOnce(new Error('statement timeout'))
    const first = await dispatchPendingPlayerNewsNotifications()
    expect(first).toMatchObject({ retryScheduled: 1, notified: 0, noRoster: 0 })
    expect(stampedIds()).toEqual([])
    expect(ledger()?.lastOutcome).toBe('recipients-unavailable')

    h.rosterFind.mockResolvedValue([roster('mgr-a', 'lg-a')])
    const second = await dispatchPendingPlayerNewsNotifications()
    expect(second).toMatchObject({ notified: 1, retryScheduled: 0 })
    expect(stampedIds()).toEqual(['news-1'])
  })

  it('a name the registry cannot bind yet is retried', async () => {
    h.newsFind.mockResolvedValue([{ ...ROW, id: 'news-2', playerName: 'Rookie Nobodyknows', headline: 'Nobodyknows (ankle) out' }])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ unboundPlayer: 1, retryScheduled: 1 })
    expect(stampedIds()).toEqual([])
    expect(ledger('news-2')?.lastOutcome).toBe('no-identity-row')
  })

  it(`gives up after ${MAX_DISPATCH_ATTEMPTS} attempts and stamps it`, async () => {
    h.rosterFind.mockRejectedValue(new Error('statement timeout'))
    for (let i = 1; i < MAX_DISPATCH_ATTEMPTS; i++) {
      expect((await dispatchPendingPlayerNewsNotifications()).retryScheduled).toBe(1)
    }
    expect(stampedIds()).toEqual([])
    const last = await dispatchPendingPlayerNewsNotifications()
    expect(last.retryScheduled).toBe(0)
    expect(stampedIds()).toEqual(['news-1'])
    expect(ledger()?.attempts).toBe(MAX_DISPATCH_ATTEMPTS)
  })

  it('a changed story starts a fresh attempt count', async () => {
    h.rosterFind.mockRejectedValue(new Error('statement timeout'))
    await dispatchPendingPlayerNewsNotifications()
    await dispatchPendingPlayerNewsNotifications()
    expect(ledger()?.attempts).toBe(2)
    h.newsFind.mockResolvedValue([{ ...ROW, headline: 'Gibbs (hamstring) downgraded to out' }])
    await dispatchPendingPlayerNewsNotifications()
    expect(ledger()?.attempts).toBe(1)
  })

  it('an unwritable ledger does not drop the story — it is retried, and the run says so', async () => {
    h.upsertFails = true
    h.rosterFind.mockRejectedValueOnce(new Error('statement timeout'))
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(out).toMatchObject({ retryScheduled: 1, ledgerUnpersisted: 1 })
    expect(stampedIds()).toEqual([])
  })
})

describe('a dispatch that throws', () => {
  it('retries only the people it missed, and nobody twice', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-a', 'lg-a'), roster('mgr-b', 'lg-b')])
    h.dispatch.mockImplementationOnce(async () => { throw new Error('dispatch blew up') })

    const first = await dispatchPendingPlayerNewsNotifications()
    expect(first).toMatchObject({ retryScheduled: 1, notified: 1, recipients: 1 })
    expect(stampedIds()).toEqual([])
    expect(ledger()?.lastOutcome).toBe('dispatch-failed')
    const firstLeagues = leagueCalls().map((p) => p.leagueId)
    expect(firstLeagues).toEqual(['lg-a', 'lg-b'])

    h.dispatch.mockClear()
    const second = await dispatchPendingPlayerNewsNotifications()
    expect(leagueCalls().map((p) => ({ leagueId: p.leagueId, userIds: p.userIds }))).toEqual([{ leagueId: 'lg-a', userIds: ['mgr-a'] }])
    expect(second).toMatchObject({ retryScheduled: 0, recipients: 1 })
    expect(stampedIds()).toEqual(['news-1'])
  })
})


it('retries a returned dispatch failure instead of stamping the story delivered', async () => {
  h.rosterFind.mockResolvedValue([roster('mgr-a', 'lg-a')])
  h.dispatch.mockResolvedValueOnce({ requested: 1, delivered: 0, suppressed: 0, failed: 1 })
  const result = await dispatchPendingPlayerNewsNotifications()
  expect(result).toMatchObject({ retryScheduled: 1, notified: 0 })
  expect(stampedIds()).toEqual([])
  expect(ledger()?.lastOutcome).toBe('dispatch-failed')
})
