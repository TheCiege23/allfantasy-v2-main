/**
 * The 5-minute offer sweep (Guap's ruling, 2026-09-25: every 5 minutes, every Sleeper league,
 * current and previous week, on the worker).
 *
 * The only sweep used to be a rotation of 20 leagues per 15 minutes, each reading all 18 weeks — a
 * lap of hours, and 124 of 124 offers in eight days were first seen already ACCEPTED. The fast lane
 * reads only the weeks a new offer can be filed under. What these pin is what a SLICE must never do:
 * bootstrap a league (the next full read would announce every older trade as new) or treat "not in
 * the slice" as "gone".
 *
 * `fetch` is stubbed, not `currentTradeIds`, so the real feed reader runs and every Sleeper path it
 * requests is recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  leagues: [] as Array<{ platformLeagueId: string; sport: string; season: number }>,
  feeds: new Map<string, Map<number, unknown[]>>(),
  paths: [] as string[],
  state: new Map<string, unknown>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        h.store.has(where.cacheKey) ? { data: structuredClone(h.store.get(where.cacheKey)) } : null,
      upsert: async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        h.store.set(where.cacheKey, structuredClone(create.data))
        return {}
      },
      create: async ({ data }: { data: { cacheKey: string; data: unknown } }) => {
        if (h.store.has(data.cacheKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        h.store.set(data.cacheKey, data.data)
        return {}
      },
      deleteMany: async () => ({ count: 0 }),
    },
    league: {
      findMany: async (args: { where?: { platformLeagueId?: string } }) =>
        args.where && 'platformLeagueId' in args.where && typeof args.where.platformLeagueId === 'string' ? [] : structuredClone(h.leagues),
    },
    appUser: { findMany: async () => [] },
    emailPreference: { findMany: async () => [] },
    userProfile: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/api-cache/SleeperCacheLayer', () => ({
  getSleeperState: async (sport: string) => h.state.get(String(sport).toUpperCase()) ?? null,
  getAllPlayers: async () => ({}),
  getLeagueUsers: async () => [],
}))
vi.mock('@/lib/import-os/collector/archiveFeedTrades', () => ({ archiveCompletedFeedTrades: async () => undefined }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: async () => null }))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  completedTradeGraderFor: async () => null,
  oneGradeForCompletedTrade: async () => null,
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: async () => null, gradeDeal: async () => null }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: async () => ({ ok: true }) }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: async () => [] }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: async () => ({ allowed: false }) }))
vi.mock('@/lib/email/marketing-email', () => ({ createEmailUnsubscribeToken: () => 'tok' }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://af.test' }))

import {
  claimRotationTick,
  detectAndNotifyLeague,
  detectAndNotifyRecent,
  planTradeNotifications,
  ROTATION_INTERVAL_MS,
} from '@/lib/trade-intel/tradeNotifyService'
import { currentTradeIds, type FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

const SEEN = (id: string) => `trade-notify:v1:${id}`
const trade = (id: string, status: 'complete' | 'pending') => ({
  transaction_id: id,
  type: 'trade',
  status,
  roster_ids: [1, 2],
  creator: 'u1',
  created: 1,
})

/** A league's feed: week → trades. Weeks not set answer an empty list, as Sleeper does. */
function feed(leagueId: string, weeks: Record<number, unknown[]>) {
  h.feeds.set(leagueId, new Map(Object.entries(weeks).map(([w, t]) => [Number(w), t])))
}

const txPaths = (leagueId: string) =>
  h.paths.filter((p) => p.startsWith(`/league/${leagueId}/transactions/`)).map((p) => Number(p.split('/').pop())).sort((a, b) => a - b)

beforeEach(() => {
  h.store.clear()
  h.feeds.clear()
  h.paths.length = 0
  h.state.clear()
  h.leagues = []
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).replace(/^https:\/\/api\.sleeper\.app\/v1/, '')
    h.paths.push(path)
    const m = path.match(/^\/league\/([^/]+)\/transactions\/(\d+)$/)
    if (m) {
      const weeks = h.feeds.get(m[1]!)
      if (!weeks) return new Response('null', { status: 404 })
      return new Response(JSON.stringify(weeks.get(Number(m[2])) ?? []), { status: 200 })
    }
    return new Response('null', { status: 404 })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('currentTradeIds — a weeks slice', () => {
  it('reads only the weeks asked for, and files each trade under its own week', async () => {
    feed('L', { 2: [trade('A', 'pending')], 4: [trade('B', 'complete')], 9: [trade('OLD', 'complete')] })
    const out = await currentTradeIds('L', { weeks: [4, 2, 3, 2] })
    expect(txPaths('L')).toEqual([2, 3, 4])
    expect(out?.map((t) => [t.id, t.week])).toEqual([['A', 2], ['B', 4]])
  })

  it('no weeks asked for reads the whole feed, as before', async () => {
    feed('L', {})
    await currentTradeIds('L')
    expect(txPaths('L')).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
  })

  it('an empty or out-of-range slice reads nothing and answers null', async () => {
    feed('L', {})
    expect(await currentTradeIds('L', { weeks: [0, 19] })).toBeNull()
    expect(h.paths).toEqual([])
  })
})

describe('🛑 a slice never bootstraps a league', () => {
  it('no seen record and no budget: deferred, nothing read, nothing written', async () => {
    feed('L', { 3: [trade('NEW', 'pending')] })
    const r = await detectAndNotifyLeague('L', { weeks: [2, 3, 4], bootstrapBudget: { left: 0 } })
    expect(r.deferred).toMatch(/full read/)
    expect(r.bootstrap).toBe(false)
    expect(h.paths).toEqual([])
    expect(h.store.has(SEEN('L'))).toBe(false)
  })

  it('no seen record with budget: the WHOLE feed is read, every trade in it is seen, nothing is sent', async () => {
    feed('L', { 3: [trade('NEW', 'pending')], 11: [trade('OLD', 'complete')] })
    const budget = { left: 1 }
    const r = await detectAndNotifyLeague('L', { weeks: [2, 3, 4], bootstrapBudget: budget })
    expect(r.bootstrap).toBe(true)
    expect(budget.left).toBe(0)
    expect(txPaths('L')).toHaveLength(18)
    expect((h.store.get(SEEN('L')) as { seen: string[] }).seen.sort()).toEqual(['NEW', 'OLD'])
  })

  it('with a seen record, only the slice is read — and a trade in an unread week is untouched', async () => {
    h.store.set(SEEN('L'), { version: 2, seen: ['OLD'], pending: [], lastRunIso: 'x' })
    feed('L', { 3: [trade('NEW', 'pending')], 11: [trade('OLDER', 'complete')] })
    const r = await detectAndNotifyLeague('L', { weeks: [2, 3, 4] })
    expect(txPaths('L')).toEqual([2, 3, 4])
    expect(r.newOffers).toBe(1)
    expect(r.newTrades).toBe(0)
    expect((h.store.get(SEEN('L')) as { seen: string[] }).seen).toEqual(['OLD', 'NEW'])
  })
})

describe('an owed offer absent from a slice is carried, not dropped', () => {
  const NOW = Date.parse('2026-09-25T12:00:00Z')
  const owed = [{ kind: 'offer' as const, id: 'T1', since: new Date(NOW - 3600_000).toISOString() }]
  const other: FeedTrade = { id: 'T9', status: 'complete', rosterIds: [1, 2], creator: null, createdMs: 1, tx: {} }

  it('slice: still owed, not retried, not dropped', () => {
    const plan = planTradeNotifications([], { seen: ['T1'], pending: ['T1'], owed }, NOW, { slice: true })
    expect(plan.owed.map((a) => a.id)).toEqual(['T1'])
    expect(plan.offers).toEqual([])
    expect(plan.dropped).toEqual([])
  })

  it('whole feed: absent means withdrawn, and it is dropped — the #1309 rule, unchanged', () => {
    const plan = planTradeNotifications([other], { seen: ['T1', 'T9'], pending: ['T1'], owed }, NOW)
    expect(plan.dropped.map((a) => a.id)).toEqual(['T1'])
  })

  it('slice: past 48h it still ages out', () => {
    const stale = [{ ...owed[0]!, since: new Date(NOW - 49 * 3600_000).toISOString() }]
    expect(planTradeNotifications([], { seen: ['T1'], owed: stale }, NOW, { slice: true }).dropped).toHaveLength(1)
  })
})

describe('detectAndNotifyRecent', () => {
  beforeEach(() => {
    h.state.set('NFL', { leg: 3, season: '2026' })
    h.leagues = [
      { platformLeagueId: 'NFL-A', sport: 'NFL', season: 2026 },
      { platformLeagueId: 'NFL-B', sport: 'NFL', season: 2026 },
      { platformLeagueId: 'NFL-LAST-YEAR', sport: 'NFL', season: 2025 },
      { platformLeagueId: 'CFB', sport: 'NCAAF', season: 2026 },
    ]
    for (const l of h.leagues) {
      h.store.set(SEEN(l.platformLeagueId), { version: 2, seen: [], pending: [], lastRunIso: 'x' })
      feed(l.platformLeagueId, {})
    }
  })

  it('every current-season league of a sport with a clock, on its current weeks', async () => {
    const r = await detectAndNotifyRecent({ concurrency: 2 })
    expect(r.results.map((x) => x.sleeperLeagueId).sort()).toEqual(['NFL-A', 'NFL-B'])
    expect(txPaths('NFL-A')).toEqual([2, 3, 4])
    expect(txPaths('NFL-B')).toEqual([2, 3, 4])
    expect(r.sports).toEqual({ NFL: { weeks: [2, 3, 4] }, NCAAF: { skipped: expect.stringMatching(/rotation/) } })
    // A finished season's league and a clockless sport are never read.
    expect(txPaths('NFL-LAST-YEAR')).toEqual([])
    expect(txPaths('CFB')).toEqual([])
  })

  it('announces a new offer found in the slice', async () => {
    feed('NFL-A', { 3: [trade('OFFER', 'pending')] })
    const r = await detectAndNotifyRecent()
    expect(r.results.find((x) => x.sleeperLeagueId === 'NFL-A')?.newOffers).toBe(1)
  })

  it('past the deadline no league is STARTED — they are counted, not silently dropped', async () => {
    const r = await detectAndNotifyRecent({ deadlineMs: -1 })
    expect(r.results).toEqual([])
    expect(r.unstarted).toBe(2)
    expect(h.paths).toEqual([])
  })

  it('no Sleeper clock at all: nothing read, and the result says why', async () => {
    h.state.clear()
    const r = await detectAndNotifyRecent()
    expect(r.results).toEqual([])
    expect(r.sports.NFL).toEqual({ skipped: expect.any(String) })
  })

  it('the bootstrap budget is shared across the sweep', async () => {
    h.store.delete(SEEN('NFL-A'))
    h.store.delete(SEEN('NFL-B'))
    const r = await detectAndNotifyRecent({ bootstrapLimit: 1, concurrency: 1 })
    expect(r.results.filter((x) => x.bootstrap)).toHaveLength(1)
    expect(r.results.filter((x) => x.deferred)).toHaveLength(1)
  })
})

describe('claimRotationTick — the rotation keeps its 15-minute cadence on a 5-minute route', () => {
  it('runs, then not within the interval, then again after it', async () => {
    const t0 = Date.parse('2026-09-25T12:00:00Z')
    expect(await claimRotationTick(t0)).toBe(true)
    expect(await claimRotationTick(t0 + 5 * 60_000)).toBe(false)
    expect(await claimRotationTick(t0 + 10 * 60_000)).toBe(false)
    expect(await claimRotationTick(t0 + ROTATION_INTERVAL_MS)).toBe(true)
  })

  it('a stamp from the future (a clock step) does not stall the rotation', async () => {
    const t0 = Date.parse('2026-09-25T12:00:00Z')
    await claimRotationTick(t0 + 60 * 60_000)
    expect(await claimRotationTick(t0)).toBe(true)
  })
})
