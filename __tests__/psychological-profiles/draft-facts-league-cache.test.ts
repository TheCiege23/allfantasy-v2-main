/**
 * P4/P5 stage A: a league profile refresh reads the league's draft facts (and their player
 * positions) once, not once per manager — and every manager's signals are identical either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  draftFact: vi.fn(),
  player: vi.fn(),
  sportsPlayer: vi.fn(),
  league: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftFact: { findMany: h.draftFact },
    player: { findMany: h.player },
    sportsPlayer: { findMany: h.sportsPlayer },
    league: { findUnique: h.league },
    leagueDynastySeason: { findMany: async () => [] },
    leagueTradeHistory: { findMany: async () => [] },
    roster: { findFirst: async () => null },
    rosterSnapshot: { findMany: async () => [] },
    seasonStandingFact: { findFirst: async () => null },
    transactionFact: { findMany: async () => [], groupBy: async () => [] },
    waiverClaim: { count: async () => 0 },
  },
}))

import { aggregateBehaviorSignals } from '@/lib/psychological-profiles/BehaviorSignalAggregator'
import { createLeagueDraftFactsCache } from '@/lib/psychological-profiles/leagueDraftFactsCache'

const MANAGERS = ['1', '2', '3', '4', '5']
const POSITIONS = ['QB', 'RB', 'WR', 'TE']

function draftFacts(leagueId: string) {
  // Each manager drafts differently, so the league-relative scores are non-trivial.
  return MANAGERS.flatMap((m, mi) =>
    Array.from({ length: 12 }, (_, r) => ({
      playerId: `${leagueId}-p${mi}-${r}`,
      round: r + 1 + (mi % 3),
      managerId: m,
    })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    platform: 'sleeper',
    platformLeagueId: `ext-${where.id}`,
    teams: MANAGERS.map((m) => ({ id: `t${m}`, externalId: m, ownerName: `owner${m}`, platformUserId: `pu${m}` })),
  }))
  h.draftFact.mockImplementation(async ({ where }: { where: { leagueId: string } }) => draftFacts(where.leagueId))
  // Half resolve through Player.id, half through SportsPlayer.sleeperId, as in production.
  h.player.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((_, i) => i % 2 === 0).map((id, i) => ({ id, position: POSITIONS[i % 4]!.toLowerCase() })))
  h.sportsPlayer.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
    where.sleeperId.in.filter((_, i) => i % 2 === 1).map((sleeperId, i) => ({ sleeperId, position: POSITIONS[(i + 1) % 4] })))
})
afterEach(() => { delete process.env.AF_READ_OPTIMIZATIONS_OFF })

async function signalsFor(leagueId: string, withCache: boolean) {
  const cache = withCache ? createLeagueDraftFactsCache() : undefined
  const out = []
  for (const m of MANAGERS) {
    out.push(await aggregateBehaviorSignals(leagueId, m, 'NFL', { sleeperUsername: `owner${m}`, season: 2026, draftFactsCache: cache }))
  }
  return out
}

describe('league draft facts are read once per league refresh', () => {
  it('produces identical signals for every manager, with and without the shared cache', async () => {
    const uncached = await signalsFor('L1', false)
    const cached = await signalsFor('L1', true)
    expect(cached).toEqual(uncached)
    // The fixture is not degenerate: picks resolved and managers differ from each other.
    expect(uncached.every((s) => s.draftPickCount === 12 && s.positionSampleCoverage > 0)).toBe(true)
    expect(new Set(uncached.map((s) => s.draftEarlyRoundRelative.toFixed(6))).size).toBeGreaterThan(1)
  })

  it('makes 1 draft-facts read and 1 position lookup per league instead of 1 per manager', async () => {
    await signalsFor('L1', false)
    expect(h.draftFact).toHaveBeenCalledTimes(MANAGERS.length)
    expect(h.player).toHaveBeenCalledTimes(MANAGERS.length)
    expect(h.sportsPlayer).toHaveBeenCalledTimes(MANAGERS.length)
    vi.clearAllMocks()
    await signalsFor('L1', true)
    expect(h.draftFact).toHaveBeenCalledTimes(1)
    expect(h.player).toHaveBeenCalledTimes(1)
    expect(h.sportsPlayer).toHaveBeenCalledTimes(1)
  })

  it('never serves one league or season from another league\'s entry', async () => {
    const cache = createLeagueDraftFactsCache()
    const a = await aggregateBehaviorSignals('L1', '1', 'NFL', { season: 2026, draftFactsCache: cache })
    const b = await aggregateBehaviorSignals('L2', '1', 'NFL', { season: 2026, draftFactsCache: cache })
    const c = await aggregateBehaviorSignals('L1', '1', 'NFL', { season: 2025, draftFactsCache: cache })
    expect(h.draftFact).toHaveBeenCalledTimes(3)
    expect(b.leagueId).toBe('L2')
    expect(a).toEqual(await aggregateBehaviorSignals('L1', '1', 'NFL', { season: 2026 }))
    expect(c).toEqual(await aggregateBehaviorSignals('L1', '1', 'NFL', { season: 2025 }))
  })

  it('does not keep a failed read: the next manager retries, as without the cache', async () => {
    const cache = createLeagueDraftFactsCache()
    h.draftFact.mockRejectedValueOnce(new Error('db blip'))
    await expect(aggregateBehaviorSignals('L1', '1', 'NFL', { season: 2026, draftFactsCache: cache })).rejects.toThrow('db blip')
    const next = await aggregateBehaviorSignals('L1', '2', 'NFL', { season: 2026, draftFactsCache: cache })
    expect(next.draftPickCount).toBe(12)
    expect(h.draftFact).toHaveBeenCalledTimes(2)
  })

  it('AF_READ_OPTIMIZATIONS_OFF=draft-facts restores one read per manager', async () => {
    process.env.AF_READ_OPTIMIZATIONS_OFF = 'draft-facts'
    const off = await signalsFor('L1', true)
    expect(h.draftFact).toHaveBeenCalledTimes(MANAGERS.length)
    delete process.env.AF_READ_OPTIMIZATIONS_OFF
    expect(off).toEqual(await signalsFor('L1', false))
  })
})
