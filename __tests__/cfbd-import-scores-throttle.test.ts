import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  CFBD_IDLE_INTERVAL_MS,
  CFBD_WINDOW_INTERVAL_MS,
  __resetCfbdThrottleForTests,
  decideCfbdFetch,
  recordCfbdAttempt,
  shouldFetchCfbdNow,
} from '@/lib/scores/cfbdThrottle'

/*
 * Measured 2026-09-23: 13,330 of this month's 15,157 import-scores runs asked CFBD for the whole
 * regular season — ~77% of the key's calls — because the cron runs every 120s and the route's gate
 * is 90s. These pin the throttle that replaces it.
 */

const NOW = new Date('2026-09-26T20:00:00Z') // a Saturday afternoon

beforeEach(() => __resetCfbdThrottleForTests())

describe('decideCfbdFetch', () => {
  it('asks when CFBD has never been asked', () => {
    expect(decideCfbdFetch({ now: NOW, lastFetchedAt: null, inGameWindow: false })).toEqual({ run: true })
  })

  it('during games: at most every 15 minutes', () => {
    const recent = new Date(NOW.getTime() - 2 * 60_000) // the old every-tick cadence
    const skip = decideCfbdFetch({ now: NOW, lastFetchedAt: recent, inGameWindow: true })
    expect(skip.run).toBe(false)
    expect(!skip.run && skip.reason).toMatch(/^skipped: CFBD throttled — last asked 2m ago, every 15m during games$/)
    expect(decideCfbdFetch({ now: NOW, lastFetchedAt: new Date(NOW.getTime() - CFBD_WINDOW_INTERVAL_MS), inGameWindow: true }).run).toBe(true)
  })

  it('outside games: at most every 6 hours', () => {
    const hourAgo = new Date(NOW.getTime() - 60 * 60_000)
    expect(decideCfbdFetch({ now: NOW, lastFetchedAt: hourAgo, inGameWindow: false }).run).toBe(false)
    expect(decideCfbdFetch({ now: NOW, lastFetchedAt: new Date(NOW.getTime() - CFBD_IDLE_INTERVAL_MS), inGameWindow: false }).run).toBe(true)
  })
})

function db(args: { newestCfbd: Date | null; windowGame: boolean; throws?: boolean }) {
  const findFirst = vi.fn(async (q: { where: { source?: string; startTime?: unknown } }) => {
    if (args.throws) throw new Error('db down')
    if (q.where.source === 'cfbd') return args.newestCfbd ? { fetchedAt: args.newestCfbd } : null
    return args.windowGame ? { id: 'g1' } : null
  })
  return { findFirst, db: { sportsGame: { findFirst } } as never }
}

describe('shouldFetchCfbdNow', () => {
  it('reads the newest CFBD row and whether a college game is in the window', async () => {
    const { db: d, findFirst } = db({ newestCfbd: new Date(NOW.getTime() - 5 * 60_000), windowGame: true })
    const out = await shouldFetchCfbdNow(NOW, d)
    expect(out.run).toBe(false)
    const windowQuery = findFirst.mock.calls.find((c) => c[0].where.startTime)![0].where as {
      sport: string
      startTime: { gte: Date; lte: Date }
    }
    expect(windowQuery.sport).toBe('NCAAF')
    expect(windowQuery.startTime.gte.toISOString()).toBe('2026-09-26T15:00:00.000Z') // kickoff within 5h
    expect(windowQuery.startTime.lte.toISOString()).toBe('2026-09-26T21:00:00.000Z') // or the next hour
  })

  it('REGRESSION GUARD: a FAILED attempt (no rows written) still throttles the next tick', async () => {
    // CFBD rows are two days old because every recent call failed (e.g. a quota wall)...
    const { db: d } = db({ newestCfbd: new Date(NOW.getTime() - 48 * 3600_000), windowGame: true })
    recordCfbdAttempt(new Date(NOW.getTime() - 2 * 60_000))
    // ...but it was ASKED two minutes ago, so it must not be asked again every tick.
    expect((await shouldFetchCfbdNow(NOW, d)).run).toBe(false)
  })

  it('never stops the feed because the throttle could not be checked', async () => {
    const { db: d } = db({ newestCfbd: null, windowGame: false, throws: true })
    expect(await shouldFetchCfbdNow(NOW, d)).toEqual({ run: true })
  })
})

describe('fetchGamesForSport honours a skip', () => {
  it('never calls CFBD when skipped, reports the reason, and still runs the other providers', async () => {
    vi.stubEnv('CFBD_KEY', 'test-key-not-a-real-credential')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchGamesForSport } = await import('@/lib/scores/gameScoreProviders')

    const attempts = await fetchGamesForSport('NCAAF', 2026, undefined, {
      skip: { cfbd: 'skipped: CFBD throttled — test' },
    })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('collegefootballdata'))).toBe(false)
    expect(urls.length).toBeGreaterThan(0) // ESPN / TheSportsDB still asked
    expect(attempts.find((a) => a.source === 'cfbd')).toEqual({ source: 'cfbd', games: [], error: 'skipped: CFBD throttled — test' })
    expect(attempts.map((a) => a.source)).toEqual(['espn', 'thesportsdb', 'cfbd'])
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
