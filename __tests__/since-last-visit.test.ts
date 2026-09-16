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

  /*
   * The trade boundary. It exists because only the trade line can be read blind — see the
   * `tradesSeenAt` note on VisitMarker — so it trails `sinceAt` for exactly as long as the trades
   * read keeps coming back partial, and is bounded by the same 7-day floor.
   */
  describe('the trade boundary', () => {
    it('falls back to the visit window on a marker written before it existed', () => {
      const legacy = marker()
      // The whole reason nothing needs migrating: an existing row simply has no boundary.
      expect(legacy.tradesSeenAt).toBeUndefined()
      const w = resolveVisitWindow(legacy, NOW)
      expect(w.tradesSinceAt.toISOString()).toBe(w.sinceAt.toISOString())
    })

    /*
     * 🛑 AND THE FALLBACK IS `lastSeenAt`, NOT `sinceAt` — the same backward-walk bug reached
     * through the legacy path, which is EVERY existing marker on the deploy that ships this.
     * Inside a session `sinceAt` is the session's opening point, so falling back to it and then
     * persisting that on a blind read writes a boundary hours older than the last render.
     */
    it('carries the last render forward, not the session start, on a legacy marker', () => {
      const w = resolveVisitWindow(
        marker({ lastSeenAt: ago(10 * 60_000).toISOString(), sinceAt: ago(30 * HOUR).toISOString() }),
        NOW,
      )
      expect(w.tradesSeenAt.toISOString()).toBe(ago(10 * 60_000).toISOString())
      // What this render MEASURES from is still the session window — the brief must not shrink.
      expect(w.tradesSinceAt.toISOString()).toBe(ago(30 * HOUR).toISOString())
    })

    it('sits further back while the trades read has been blind', () => {
      const w = resolveVisitWindow(marker({ tradesSeenAt: ago(12 * HOUR).toISOString() }), NOW)
      expect(w.sinceAt.toISOString()).toBe(ago(5 * HOUR).toISOString())
      expect(w.tradesSinceAt.toISOString()).toBe(ago(12 * HOUR).toISOString())
    })

    /*
     * Never AHEAD of the window: a boundary that drifted forward would skip trades. Note this
     * clamps only what this RENDER measures from — `tradesSeenAt` is what gets carried forward,
     * and it keeps the unclamped value so a blind reload cannot persist the projection.
     */
    it('clamps what it measures from to the visit window, but carries the real value forward', () => {
      const w = resolveVisitWindow(marker({ tradesSeenAt: ago(1 * HOUR).toISOString() }), NOW)
      expect(w.tradesSinceAt.toISOString()).toBe(w.sinceAt.toISOString())
      expect(w.tradesSeenAt.toISOString()).toBe(ago(1 * HOUR).toISOString())
    })

    /*
     * ⚠ `isMarker` validates version/lastSeenAt/sinceAt and nothing else, so a corrupt
     * `tradesSeenAt` reaches here.
     *
     * 🛑 THE DANGEROUS SHAPE IS A TRUTHY NUMBER, and the first version of this test missed it by
     * using `0` — which is falsy, so the old truthiness check caught it and the control stayed
     * green. An epoch number is truthy AND parses to a valid date, so it sails past
     * `Number.isFinite`, clamps to the floor, and silently opens the trade window to the full
     * 7 days. Only a `typeof` check rejects it.
     */
    it.each([
      ['an epoch number', 1_700_000_000_000 as unknown as string],
      ['an unparseable string', 'not-a-date'],
    ])('falls back rather than trusting %s in tradesSeenAt', (_label, value) => {
      const w = resolveVisitWindow(marker({ tradesSeenAt: value }), NOW)
      expect(w.tradesSeenAt.toISOString()).toBe(ago(5 * HOUR).toISOString())
      expect(w.tradesSinceAt.toISOString()).toBe(w.sinceAt.toISOString())
    })

    it('is floored at 7 days, however long the read has been blind', () => {
      const w = resolveVisitWindow(marker({ tradesSeenAt: ago(40 * 24 * HOUR).toISOString() }), NOW)
      expect(w.tradesSinceAt.getTime()).toBe(NOW.getTime() - MAX_WINDOW_MS)
    })

    it('holds across a reload inside the same session', () => {
      const w = resolveVisitWindow(
        marker({ lastSeenAt: ago(SESSION_GAP_MS - 60_000).toISOString(), tradesSeenAt: ago(40 * HOUR).toISOString() }),
        NOW,
      )
      expect(w.sinceAt.toISOString()).toBe(ago(30 * HOUR).toISOString())
      expect(w.tradesSinceAt.toISOString()).toBe(ago(40 * HOUR).toISOString())
    })
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

  const run = (recordVisit: boolean, tradesComplete = true) =>
    getSinceLastVisit({
      userId: 'user-1', leagues: LEAGUES, recentTrades: [], tradesLimit: 3, now: NOW, recordVisit, tradesComplete,
    })

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

  /*
   * 🛑 A BLIND TRADES READ HOLDS THE TRADE BOUNDARY, AND NOTHING ELSE.
   *
   * The marker is one blob: `lastSeenAt`, the visit window, AND the standings/injury snapshot the
   * next visit diffs against. Refusing to write it at all — the first version of this fix — froze
   * all three on any flaky league, and a new user whose first render had one league fail would
   * report "we cannot compare yet" indefinitely. Only the trade line can be read blind, so only
   * the trade line has a boundary to hold.
   */
  it('advances the visit and the snapshot on a blind trades read, but not the trade boundary', async () => {
    await run(true, false)
    expect(h.cacheUpsert).toHaveBeenCalledTimes(1)
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as VisitMarker
    // The visit and the comparison baseline still move — those reads worked.
    expect(written.lastSeenAt).toBe(NOW.toISOString())
    expect(written.latest?.standings.L1).toEqual({ rank: 3, wins: 3, losses: 1, ties: 0 })
    // The trade boundary stays where it was, so the unseen trades are still reportable next time.
    expect(written.tradesSeenAt).toBe(ago(5 * HOUR).toISOString())
  })

  /*
   * 🛑 AND IT MUST NOT MOVE BACKWARD EITHER — the case the test above is structurally blind to.
   *
   * With the default fixture the marker's `tradesSeenAt`, its `sinceAt` and the resolved window
   * all collapse to the same instant, so "held the previous boundary" and "wrote the clamped
   * projection" are indistinguishable. They are different values INSIDE a session, where
   * `sinceAt` is the session's opening point: a complete read at 09:00 followed by one blind
   * reload at 09:10 wrote a boundary from the previous day. Bounded and self-healing, but it
   * re-reports trades the user has already been shown.
   */
  it.each([
    ['a boundary of its own', ago(HOUR).toISOString(), ago(HOUR).toISOString()],
    // The legacy path: no boundary yet, so the last render is the best evidence there is.
    ['no boundary yet (a marker from before this field)', undefined, ago(10 * 60_000).toISOString()],
  ])('does not walk the boundary backward on a blind reload inside a session, with %s', async (_l, tradesSeenAt, expected) => {
    h.cacheFind.mockResolvedValue({
      data: marker({
        lastSeenAt: ago(10 * 60_000).toISOString(), // inside SESSION_GAP_MS: same session
        sinceAt: ago(30 * HOUR).toISOString(), // the session opened yesterday
        tradesSeenAt, // a COMPLETE read an hour ago, or none recorded at all
      }),
    })
    await run(true, false)
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as VisitMarker
    expect(written.tradesSeenAt).toBe(expected)
  })

  it('advances the trade boundary when the trades read could stand behind itself', async () => {
    await run(true, true)
    const written = h.cacheUpsert.mock.calls[0]![0].update.data as VisitMarker
    expect(written.tradesSeenAt).toBe(NOW.toISOString())
  })

  it('measures the trade line from the held boundary, not from the visit', async () => {
    // Two renders ago the trades read went blind; the trade from then has never been shown.
    h.cacheFind.mockResolvedValue({
      data: marker({ lastSeenAt: ago(HOUR).toISOString(), tradesSeenAt: ago(9 * HOUR).toISOString() }),
    })
    const brief = await getSinceLastVisit({
      userId: 'user-1',
      leagues: LEAGUES,
      recentTrades: [
        {
          id: 't-old', leagueId: 'L1', leagueName: 'Dynasty Gridiron', platformLeagueId: '1',
          acceptedAt: ago(5 * HOUR).toISOString(), sides: [], partial: false, verdict: null,
        },
      ],
      tradesLimit: 3,
      now: NOW,
      recordVisit: false,
      tradesComplete: true,
    })
    // `sinceAt` is one hour ago, so a visit-window read would have dropped this trade entirely.
    expect(brief?.sinceAt).toBe(ago(HOUR).toISOString())
    expect(brief?.trades.items.map((t) => t.leagueId)).toEqual(['L1'])
    /*
     * And the brief SAYS the trade line reaches further back, so the card can stop printing a
     * window the rows do not obey — "since 1h ago" over a five-hour-old trade, with no date on
     * the row to contradict it.
     */
    expect(brief?.tradesSinceAt).toBe(ago(9 * HOUR).toISOString())
  })

  it('reports the same boundary for both when the trades read was complete', async () => {
    const brief = await run(false, true)
    expect(brief?.tradesSinceAt).toBe(brief?.sinceAt)
  })

  it('renders nothing when nothing changed', async () => {
    h.notifFind.mockResolvedValue([])
    h.teamFind.mockImplementation(async (args: { select: Record<string, boolean> }) =>
      args.select.currentRank ? [{ leagueId: 'L1', currentRank: 5, wins: 2, losses: 1, ties: 0 }] : [],
    )
    await expect(run(true)).resolves.toBeNull()
  })
})
