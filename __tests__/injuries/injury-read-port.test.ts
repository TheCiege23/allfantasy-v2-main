/**
 * Canonical injury read port.
 *
 * The behaviours under test are the ones ad-hoc `sportsInjury.findMany` calls
 * get wrong today: multi-source rows for one player, stale rows outranking fresh
 * ones, and name collisions binding the wrong athlete.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsInjury: { findMany: mocks.findMany, groupBy: mocks.groupBy } },
}))

import {
  INJURY_STALE_AFTER_HOURS,
  getInjuryFeedHealth,
  listInjuryFacts,
  resolveInjuryFacts,
} from '@/lib/injuries/injuryReadPort'

const NOW = new Date('2026-08-10T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    playerName: 'Ty Johnson',
    status: 'Questionable',
    type: 'Knee',
    description: 'Questionable For Week 1 At Houston',
    date: hoursAgo(48),
    week: 1,
    source: 'rolling_insights',
    fetchedAt: hoursAgo(1),
    team: 'Buffalo Bills',
    position: null,
    ...over,
  }
}

describe('resolveInjuryFacts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the fact for a matched player', async () => {
    mocks.findMany.mockResolvedValue([row()])
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Ty Johnson' }], now: NOW })
    const fact = res.byPlayer.get('ty johnson')
    expect(fact?.status).toBe('Questionable')
    expect(fact?.type).toBe('Knee')
    expect(fact?.stale).toBe(false)
    expect(res.feedStale).toBe(false)
  })

  it('prefers the FRESHER row when two providers describe the same player', async () => {
    // The exact production hazard: a frozen api_sports row alongside a live RI
    // one. Any consumer ordering by `date` could pick the stale one.
    mocks.findMany.mockResolvedValue([
      row({ source: 'api_sports', status: 'Out', fetchedAt: hoursAgo(17 * 24), date: hoursAgo(1) }),
      row({ source: 'rolling_insights', status: 'Questionable', fetchedAt: hoursAgo(1) }),
    ])
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Ty Johnson' }], now: NOW })
    const fact = res.byPlayer.get('ty johnson')
    expect(fact?.status).toBe('Questionable')
    expect(fact?.source).toBe('rolling_insights')
  })

  it('marks a stale row as stale instead of hiding or silently serving it', async () => {
    mocks.findMany.mockResolvedValue([row({ fetchedAt: hoursAgo(INJURY_STALE_AFTER_HOURS + 5) })])
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Ty Johnson' }], now: NOW })
    const fact = res.byPlayer.get('ty johnson')
    // Still returned — the caller decides how to caveat — but flagged, because
    // a two-week-old "Questionable" is a false statement, not old data.
    expect(fact).toBeDefined()
    expect(fact?.stale).toBe(true)
    expect(res.feedStale).toBe(true)
  })

  it('REFUSES an ambiguous name rather than binding the wrong athlete', async () => {
    // QB Josh Allen vs LB Josh Allen. RI supplies no position on injury rows, so
    // this collision genuinely cannot be split — and a missing badge is a gap
    // while the wrong player's badge is a falsehood.
    mocks.findMany.mockResolvedValue([
      row({ playerName: 'Josh Allen', team: 'Buffalo Bills', status: 'Questionable' }),
      row({ playerName: 'Josh Allen', team: 'Jacksonville Jaguars', status: 'Out' }),
    ])
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Josh Allen' }], now: NOW })
    expect(res.byPlayer.has('josh allen')).toBe(false)
    expect(res.ambiguous).toEqual(['Josh Allen'])
  })

  it('splits a collision when the caller supplies a matching team', async () => {
    mocks.findMany.mockResolvedValue([
      row({ playerName: 'Josh Allen', team: 'BUF', status: 'Questionable' }),
      row({ playerName: 'Josh Allen', team: 'JAX', status: 'Out' }),
    ])
    const res = await resolveInjuryFacts({
      sport: 'NFL',
      players: [{ name: 'Josh Allen', team: 'JAX' }],
      now: NOW,
    })
    expect(res.byPlayer.get('josh allen')?.status).toBe('Out')
    expect(res.ambiguous).toEqual([])
  })

  it('omits players with no injury row — absence is "no news", not "healthy"', async () => {
    mocks.findMany.mockResolvedValue([row()])
    const res = await resolveInjuryFacts({
      sport: 'NFL',
      players: [{ name: 'Ty Johnson' }, { name: 'Healthy Guy' }],
      now: NOW,
    })
    expect(res.byPlayer.has('ty johnson')).toBe(true)
    expect(res.byPlayer.has('healthy guy')).toBe(false)
  })

  it('reports feedStale when ingestion itself has stopped', async () => {
    mocks.findMany.mockResolvedValue([row({ fetchedAt: hoursAgo(17 * 24) })])
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Ty Johnson' }], now: NOW })
    // This is the 17-day outage. The port must be able to say so.
    expect(res.feedStale).toBe(true)
  })

  it('degrades to empty on a query failure rather than throwing', async () => {
    mocks.findMany.mockRejectedValue(new Error('db down'))
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [{ name: 'Ty Johnson' }], now: NOW })
    expect(res.byPlayer.size).toBe(0)
    expect(res.feedStale).toBe(true)
  })

  it('short-circuits with no players and never queries', async () => {
    const res = await resolveInjuryFacts({ sport: 'NFL', players: [], now: NOW })
    expect(res.byPlayer.size).toBe(0)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})

describe('listInjuryFacts (Slice 18 follow-on — list-shaped surfaces)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('collapses multi-provider duplicates to ONE row per player, freshest source winning', async () => {
    mocks.findMany.mockResolvedValue([
      row({ id: 'ri-1', source: 'rolling_insights', status: 'Questionable', fetchedAt: hoursAgo(1) }),
      row({ id: 'as-1', source: 'api_sports', status: 'Out', fetchedAt: hoursAgo(17 * 24) }),
      row({ id: 'ri-2', playerName: 'Other Guy', team: 'MIA', status: 'Out', fetchedAt: hoursAgo(2) }),
    ])
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW })
    expect(res.facts).toHaveLength(2)
    const ty = res.facts.find((f) => f.playerName === 'Ty Johnson')
    expect(ty?.status).toBe('Questionable')
    expect(ty?.source).toBe('rolling_insights')
  })

  it('keeps BOTH sides of a same-name collision on different teams — a list has no lookup to mis-bind', async () => {
    mocks.findMany.mockResolvedValue([
      row({ id: 'a', playerName: 'Josh Allen', team: 'BUF', status: 'Questionable' }),
      row({ id: 'b', playerName: 'Josh Allen', team: 'JAX', status: 'Out' }),
    ])
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW })
    expect(res.facts).toHaveLength(2)
  })

  it('returns stale rows FLAGGED, never hidden, and reports feedStale', async () => {
    mocks.findMany.mockResolvedValue([row({ id: 'a', fetchedAt: hoursAgo(INJURY_STALE_AFTER_HOURS + 10) })])
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW })
    expect(res.facts[0]?.stale).toBe(true)
    expect(res.feedStale).toBe(true)
  })

  it('sorts freshest-first and respects the limit AFTER dedup', async () => {
    mocks.findMany.mockResolvedValue([
      row({ id: 'a', playerName: 'A', team: 'BUF', fetchedAt: hoursAgo(3) }),
      row({ id: 'b', playerName: 'B', team: 'MIA', fetchedAt: hoursAgo(1) }),
      row({ id: 'c', playerName: 'C', team: 'KC', fetchedAt: hoursAgo(2) }),
    ])
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW, limit: 2 })
    expect(res.facts.map((f) => f.playerName)).toEqual(['B', 'C'])
  })

  it('carries team/position/id through for ticker rendering', async () => {
    mocks.findMany.mockResolvedValue([row({ id: 'ri-9', position: 'RB' })])
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW })
    expect(res.facts[0]).toMatchObject({ id: 'ri-9', team: 'Buffalo Bills', position: 'RB' })
  })

  it('degrades to empty on a query failure rather than throwing', async () => {
    mocks.findMany.mockRejectedValue(new Error('db down'))
    const res = await listInjuryFacts({ sport: 'NFL', now: NOW })
    expect(res.facts).toEqual([])
    expect(res.feedStale).toBe(true)
  })
})

describe('getInjuryFeedHealth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('summarises rows and freshness per source', async () => {
    mocks.groupBy.mockResolvedValue([
      { source: 'rolling_insights', _count: { _all: 311 }, _max: { fetchedAt: hoursAgo(1) } },
      { source: 'api_sports', _count: { _all: 12 }, _max: { fetchedAt: hoursAgo(400) } },
    ])
    const h = await getInjuryFeedHealth('NFL', NOW)
    expect(h.rowsLive).toBe(323)
    expect(h.stale).toBe(false) // newest across sources is 1h old
    expect(h.bySource).toHaveLength(2)
  })

  it('reports stale when nothing has arrived recently', async () => {
    mocks.groupBy.mockResolvedValue([
      { source: 'api_sports', _count: { _all: 12 }, _max: { fetchedAt: hoursAgo(17 * 24) } },
    ])
    const h = await getInjuryFeedHealth('NFL', NOW)
    expect(h.stale).toBe(true)
    expect(h.ageHours).toBeGreaterThan(INJURY_STALE_AFTER_HOURS)
  })

  it('reports stale when the table is empty', async () => {
    mocks.groupBy.mockResolvedValue([])
    const h = await getInjuryFeedHealth('NFL', NOW)
    expect(h.stale).toBe(true)
    expect(h.rowsLive).toBe(0)
  })
})
