/**
 * "Since your last visit" — the window rules, each comparison, and the loader.
 *
 * ⚠ THE RULE THAT MATTERS MOST IS THE ONE NO SCREEN SHOWS: a prefetch must never
 * move your visit. Next prefetches every link that scrolls into view, and a brief
 * whose window silently resets on a hover would read "nothing changed" to someone
 * who has not looked in a week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  teamFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
  notifFind: vi.fn(),
  resolveInjuryFacts: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: h.cacheFind, upsert: h.cacheUpsert },
    leagueTeam: { findMany: h.teamFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
    platformNotification: { findMany: h.notifFind },
  },
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.resolveInjuryFacts }))

import {
  MAX_WINDOW_MS,
  SESSION_GAP_MS,
  diffInjuries,
  diffStandings,
  getSinceLastVisit,
  groupAlerts,
  resolveVisitWindow,
  tradesSince,
  type VisitMarker,
  type VisitSnapshot,
} from '@/lib/core-app/sinceLastVisit'
import type { RecentTrade } from '@/lib/core-app/recentTrades'

const NOW = new Date('2026-09-14T15:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const HOUR = 3_600_000

const snap = (over: Partial<VisitSnapshot> = {}): VisitSnapshot => ({
  takenAt: ago(HOUR).toISOString(),
  standings: {},
  injuries: {},
  ...over,
})

const marker = (over: Partial<VisitMarker> = {}): VisitMarker => ({
  version: 1,
  lastSeenAt: ago(5 * HOUR).toISOString(),
  sinceAt: ago(30 * HOUR).toISOString(),
  firstVisit: false,
  baseline: snap({ takenAt: 'baseline' }),
  latest: snap({ takenAt: 'latest' }),
  ...over,
})

describe('resolveVisitWindow', () => {
  it('first visit: the last 7 days, nothing to compare against', () => {
    const w = resolveVisitWindow(null, NOW)
    expect(w).toMatchObject({ firstVisit: true, windowCapped: true, baseline: null })
    expect(w.sinceAt.getTime()).toBe(NOW.getTime() - MAX_WINDOW_MS)
  })

  it('a new session starts from your last visit and compares against what that session last saw', () => {
    const w = resolveVisitWindow(marker(), NOW)
    expect(w.sinceAt.toISOString()).toBe(ago(5 * HOUR).toISOString())
    expect(w.baseline?.takenAt).toBe('latest')
    expect(w.firstVisit).toBe(false)
  })

  /* Reloading the home must not wipe the brief. */
  it('a reload inside the same session keeps the same window and baseline', () => {
    const w = resolveVisitWindow(marker({ lastSeenAt: ago(SESSION_GAP_MS - 60_000).toISOString() }), NOW)
    expect(w.sinceAt.toISOString()).toBe(ago(30 * HOUR).toISOString())
    expect(w.baseline?.takenAt).toBe('baseline')
  })

  it('caps a long absence at 7 days', () => {
    const w = resolveVisitWindow(marker({ lastSeenAt: ago(20 * 24 * HOUR).toISOString() }), NOW)
    expect(w.sinceAt.getTime()).toBe(NOW.getTime() - MAX_WINDOW_MS)
    expect(w.windowCapped).toBe(true)
  })
})

describe('tradesSince', () => {
  const trade = (id: string, hoursAgo: number): RecentTrade => ({
    id,
    leagueId: 'L1',
    leagueName: 'Dynasty Gridiron',
    platformLeagueId: 'SL1',
    acceptedAt: ago(hoursAgo * HOUR).toISOString(),
    partial: false,
    verdict: null,
    sides: [
      { rosterId: 1, managerName: 'chxnk', teamName: null, received: [{ kind: 'player', name: 'Darren Waller', position: 'TE' }] },
      { rosterId: 2, managerName: 'Hustead', teamName: null, received: [{ kind: 'pick', name: '2027 4th', position: null }] },
    ],
  }) as unknown as RecentTrade

  it('keeps only trades after your last visit, in plain words', () => {
    const r = tradesSince([trade('a', 1), trade('b', 50)], ago(10 * HOUR), 3)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.summary).toBe('chxnk got Darren Waller; Hustead got 2027 4th')
    expect(r.atLeast).toBe(false)
  })

  /* The home loads only the newest 3 — when all 3 are new there may be more. */
  it('says "at least" when the capped list is entirely new', () => {
    const r = tradesSince([trade('a', 1), trade('b', 2), trade('c', 3)], ago(10 * HOUR), 3)
    expect(r.atLeast).toBe(true)
  })
})

describe('diffInjuries', () => {
  const meta = new Map([
    ['p1', { name: 'George Kittle', position: 'TE', leagues: ['A', 'B'] }],
    ['p2', { name: 'Alec Pierce', position: 'WR', leagues: ['A'] }],
    ['p3', { name: 'Chris Bell', position: 'WR', leagues: ['B'] }],
  ])

  it('reports a status that changed, and nothing that did not', () => {
    const baseline = snap({ injuries: { p1: 'Questionable', p2: 'Out' } })
    const current = snap({ injuries: { p1: 'Out', p2: 'Out' } })
    expect(diffInjuries(baseline, current, meta)).toEqual([
      { playerId: 'p1', name: 'George Kittle', position: 'TE', from: 'Questionable', to: 'Out', leagues: ['A', 'B'] },
    ])
  })

  /* Absent means "we could not say" (no fresh fact), never "healthy". */
  it('never compares a player missing from either snapshot', () => {
    const baseline = snap({ injuries: { p1: 'Questionable' } })
    const current = snap({ injuries: { p3: 'Out' } })
    expect(diffInjuries(baseline, current, meta)).toEqual([])
  })

  it('has nothing to say without a baseline', () => {
    expect(diffInjuries(null, snap({ injuries: { p1: 'Out' } }), meta)).toEqual([])
  })
})

describe('diffStandings', () => {
  const names = new Map([['L1', 'Dynasty Gridiron']])

  it('reports a result and a rank move', () => {
    const baseline = snap({ standings: { L1: { rank: 5, wins: 2, losses: 1, ties: 0 } } })
    const current = snap({ standings: { L1: { rank: 3, wins: 3, losses: 1, ties: 0 } } })
    expect(diffStandings(baseline, current, names)).toEqual([
      { leagueId: 'L1', leagueName: 'Dynasty Gridiron', wins: 3, losses: 1, ties: 0, won: 1, lost: 0, tied: 0, rank: 3, previousRank: 5 },
    ])
  })

  it('treats a record that went down as a rollover, not a result', () => {
    const baseline = snap({ standings: { L1: { rank: 2, wins: 12, losses: 5, ties: 0 } } })
    const current = snap({ standings: { L1: { rank: 1, wins: 0, losses: 0, ties: 0 } } })
    expect(diffStandings(baseline, current, names)).toEqual([])
  })

  it('stays quiet when nothing moved', () => {
    const s = { L1: { rank: 2, wins: 1, losses: 1, ties: 0 } }
    expect(diffStandings(snap({ standings: s }), snap({ standings: s }), names)).toEqual([])
  })
})

describe('groupAlerts', () => {
  it('groups by type with readable labels, biggest first', () => {
    const r = groupAlerts([
      { type: 'chimmy_alert', title: 'A', createdAt: ago(3 * HOUR) },
      { type: 'player_injury_update', title: 'B', createdAt: ago(2 * HOUR) },
      { type: 'chimmy_alert', title: 'C', createdAt: ago(1 * HOUR) },
    ])
    expect(r.total).toBe(3)
    expect(r.groups).toEqual([
      { type: 'chimmy_alert', label: 'Chimmy alerts', count: 2, latestTitle: 'C' },
      { type: 'player_injury_update', label: 'injury updates', count: 1, latestTitle: 'B' },
    ])
  })
})

describe('getSinceLastVisit', () => {
  const LEAGUES = [{ id: 'L1', name: 'Dynasty Gridiron', sport: 'NFL' }]

  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.cacheFind.mockResolvedValue({ data: marker({ latest: snap({ standings: { L1: { rank: 5, wins: 2, losses: 1, ties: 0 } } }) }) })
    h.cacheUpsert.mockResolvedValue({})
    h.teamFind.mockImplementation(async (args: { select: Record<string, boolean> }) =>
      args.select.currentRank
        ? [{ leagueId: 'L1', currentRank: 3, wins: 3, losses: 1, ties: 0 }]
        : [{ leagueId: 'L1', platformUserId: 'sleeper-u', externalId: '4' }],
    )
    h.rosterFind.mockResolvedValue([])
    h.playerFind.mockResolvedValue([])
    h.notifFind.mockResolvedValue([{ type: 'chimmy_alert', title: 'Start Kittle', createdAt: ago(HOUR) }])
    h.resolveInjuryFacts.mockResolvedValue(null)
  })

  const run = (recordVisit: boolean) =>
    getSinceLastVisit({ userId: 'user-1', leagues: LEAGUES, recentTrades: [], tradesLimit: 3, now: NOW, recordVisit })

  it('builds the brief from the previous session and records this visit', async () => {
    const brief = await run(true)
    expect(brief?.standings[0]).toMatchObject({ leagueName: 'Dynasty Gridiron', won: 1, rank: 3, previousRank: 5 })
    expect(brief?.alerts).toMatchObject({ total: 1 })
    expect(h.cacheUpsert).toHaveBeenCalledTimes(1)
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as VisitMarker
    expect(written.lastSeenAt).toBe(NOW.toISOString())
    expect(written.latest?.standings.L1).toEqual({ rank: 3, wins: 3, losses: 1, ties: 0 })
  })

  it('a prefetch reads the brief but never moves your visit', async () => {
    await run(false)
    expect(h.cacheUpsert).not.toHaveBeenCalled()
  })

  it('asks only for YOUR unread alerts since the last visit', async () => {
    await run(true)
    const where = h.notifFind.mock.calls[0]![0].where
    expect(where).toMatchObject({ userId: 'user-1', readAt: null })
    expect(where.createdAt.gt.toISOString()).toBe(ago(5 * HOUR).toISOString())
  })

  it('renders nothing when nothing changed', async () => {
    h.notifFind.mockResolvedValue([])
    h.teamFind.mockImplementation(async (args: { select: Record<string, boolean> }) =>
      args.select.currentRank ? [{ leagueId: 'L1', currentRank: 5, wins: 2, losses: 1, ties: 0 }] : [],
    )
    await expect(run(true)).resolves.toBeNull()
  })
})
