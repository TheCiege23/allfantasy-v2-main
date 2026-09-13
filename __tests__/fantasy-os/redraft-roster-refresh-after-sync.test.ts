/**
 * The post-sync redraft roster refresh, and the store that tells it which leagues changed.
 *
 * 🛑 WHY THIS EXISTS. The collector rewrites `Roster.playerData` every ten minutes and nothing
 * followed it into `RedraftRosterPlayer`: 1,261 active imported rows measured 2026-09-13 for
 * players no longer on their team, 234 of them double-rostered. The fix has two halves and each
 * can silently do nothing — a store that never records a change, or a pass that never runs one —
 * so each half is pinned here on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  apply: vi.fn(),
  resolveLeagues: vi.fn(),
  prisma: {
    leagueSyncState: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    league: { updateMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/import-os/collector/applySleeperLeagueSync', () => ({ applySleeperScopeToLeague: h.apply }))
vi.mock('@/lib/import-os/collector/enumerate', () => ({ resolveLeagueIdsForConnection: h.resolveLeagues }))

import { createPrismaSleeperSyncStore } from '@/lib/import-os/collector/prismaSyncStore'
import { refreshRedraftRosterPlayersAfterSync } from '@/lib/import-os/collector/refreshRedraftRosterPlayersAfterSync'

const connection = {
  runKey: 'sleeper:123:2026',
  provider: 'sleeper',
  externalLeagueId: '123',
  season: 2026,
  sport: 'NFL',
} as never

const applied = (over: Partial<{ imported: number; unchanged: number; removed: number }> = {}) => ({
  imported: 0, unchanged: 0, rejected: 0, removed: 0, notes: [], ...over,
})

function store() {
  return createPrismaSleeperSyncStore({
    connection,
    loadNormalized: async () => ({}) as never,
    reconcileRemovals: true,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  h.resolveLeagues.mockResolvedValue([{ id: 'L1' }, { id: 'L2' }])
})

describe('the store records which leagues a sync changed the rosters of', () => {
  it('records every mirror league whose rosters changed', async () => {
    h.apply.mockResolvedValue(applied({ imported: 3 }))
    const s = store()
    await s.persistScope('rk', 'teams_rosters', [])
    expect(s.rosterChangedLeagueIds().sort()).toEqual(['L1', 'L2'])
  })

  it('records a league whose change was a removal alone', async () => {
    h.apply.mockImplementation(async ({ leagueId }: { leagueId: string }) =>
      leagueId === 'L1' ? applied({ removed: 1 }) : applied({ unchanged: 12 }),
    )
    const s = store()
    await s.persistScope('rk', 'teams_rosters', [])
    expect(s.rosterChangedLeagueIds()).toEqual(['L1'])
  })

  it('🛑 does not record a league whose rosters came back unchanged', async () => {
    // Nothing moved, so nothing is newly stale — and every league is re-synced every ten minutes.
    h.apply.mockResolvedValue(applied({ unchanged: 12 }))
    const s = store()
    await s.persistScope('rk', 'teams_rosters', [])
    expect(s.rosterChangedLeagueIds()).toEqual([])
  })

  it('🛑 does not record a change in any other scope', async () => {
    h.apply.mockResolvedValue(applied({ imported: 5 }))
    const s = store()
    await s.persistScope('rk', 'league_state', [])
    await s.persistScope('rk', 'transactions', [])
    await s.persistScope('rk', 'traded_picks', [])
    expect(s.rosterChangedLeagueIds()).toEqual([])
  })
})

const counts = { playersDropped: 2, playersCreated: 1, playersRepaired: 0 }

describe('the post-sync refresh', () => {
  it('materializes each changed league once, however many connections named it', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2'] }, { rosterChangedLeagueIds: ['L2'] }, {}],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['L1', 'L2'])
    expect(out).toMatchObject({ changedLeagues: 2, refreshed: 2, deferred: 0, playersDropped: 4, playersCreated: 2 })
  })

  it('🛑 stops at the league cap and REPORTS what it deferred', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2', 'L3'] }],
      maxLeagues: 2,
      budgetMs: 60_000,
      materialize,
    })
    expect(materialize).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ refreshed: 2, deferred: 1 })
  })

  it('🛑 stops starting leagues once the time budget is spent', async () => {
    let clock = 0
    const materialize = vi.fn(async (_leagueId: string) => {
      clock += 40_000
      return counts
    })
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2', 'L3'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      now: () => clock,
    })
    expect(materialize).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ refreshed: 2, deferred: 1 })
  })

  it('🛑 one league failing does not stop the others, and the failure is reported', async () => {
    const materialize = vi.fn(async (leagueId: string) => {
      if (leagueId === 'L1') throw new Error('db down')
      return counts
    })
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
    })
    expect(out.refreshed).toBe(1)
    expect(out.errors).toEqual([{ leagueId: 'L1', error: 'db down' }])
  })

  it('does nothing when no rosters changed', async () => {
    const materialize = vi.fn()
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }, {}],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(out).toMatchObject({ changedLeagues: 0, refreshed: 0, deferred: 0 })
  })
})
