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

/** Discovery double: the leagues whose redraft rows disagree with their rosters. */
const needs = (...entries: Array<[string, number, number?]>) => async () =>
  entries.map(([leagueId, stale, missing = 0]) => ({ leagueId, stale, missing, unlinked: 0 }))

/** Discovery double including the third reason a league is listed: a roster with no redraft link. */
const needsWithUnlinked =
  (...entries: Array<{ leagueId: string; stale?: number; missing?: number; unlinked?: number }>) =>
  async () =>
    entries.map((e) => ({ stale: 0, missing: 0, unlinked: 0, ...e }))

describe('the post-sync refresh works on leagues that need it', () => {
  /*
   * 🛑 THE FAILURE THIS PINS, MEASURED 2026-09-13 17:29Z. One sync changed rosters in ~40 leagues,
   * 11 of which gained stale or missing rows; the pass reaches ~5 a run; nothing was dropped or
   * added. Changed-but-clean leagues were spending the budget, and a league past the cap was lost.
   */
  it('materializes only leagues that need work, largest gap first, and counts clean ones as skipped', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['clean1', 'small', 'clean2', 'big'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(['small', 1], ['big', 3, 2]),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['big', 'small'])
    expect(out).toMatchObject({
      changedLeagues: 4, needingWork: 2, skippedClean: 2, carriedOver: 0, refreshed: 2, deferred: 0,
      playersDropped: 4, playersCreated: 2, discoveryError: null,
    })
  })

  it('🛑 carries over a league that needs work but did not change this run, after the changed ones', async () => {
    // The deferral from an earlier run: nothing persisted it, and it is found again anyway.
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['changed'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(['leftover', 9], ['changed', 1]),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['changed', 'leftover'])
    expect(out).toMatchObject({ carriedOver: 1, refreshed: 2 })
  })

  it('refreshes leagues that need work even when no roster changed this run', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }, {}],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(['drifted', 2]),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['drifted'])
    expect(out).toMatchObject({ changedLeagues: 0, carriedOver: 1, refreshed: 1 })
  })

  it('materializes each league once, however many connections named it', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2'] }, { rosterChangedLeagueIds: ['L2'] }, {}],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(['L1', 1], ['L2', 1]),
    })
    expect(materialize).toHaveBeenCalledTimes(2)
    expect(out.changedLeagues).toBe(2)
  })

  it('🛑 stops at the league cap and REPORTS what it deferred', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2', 'L3'] }],
      maxLeagues: 2,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(['L1', 3], ['L2', 2], ['L3', 1]),
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
      findLeaguesNeedingWork: needs(['L1', 3], ['L2', 2], ['L3', 1]),
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
      findLeaguesNeedingWork: needs(['L1', 2], ['L2', 1]),
    })
    expect(out.refreshed).toBe(1)
    expect(out.errors).toEqual([{ leagueId: 'L1', error: 'db down' }])
  })

  it('🛑 a failed discovery falls back to the changed leagues, and says so', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['L1', 'L2'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: async () => {
        throw new Error('query timeout')
      },
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['L1', 'L2'])
    expect(out).toMatchObject({ discoveryError: 'query timeout', needingWork: null, refreshed: 2 })
  })

  it('does nothing when no league needs work', async () => {
    const materialize = vi.fn()
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['clean'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needs(),
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(out).toMatchObject({ changedLeagues: 1, needingWork: 0, skippedClean: 1, refreshed: 0, deferred: 0 })
  })
})

/*
 * 🛑 THE DISCOVERY GAP, MEASURED IN PRODUCTION 2026-09-18. Both counts above read rosters that are
 * ALREADY linked to a redraft roster, so a roster with no link cannot put its league on the list —
 * and the linking (#1018) only happens inside the materializer, which only runs on a listed league.
 * 256 unlinked imported rosters across 35 leagues sat in that circle, 183 of them the orphan
 * rosters #1005 restored; in the hour after #1018 deployed only the 24 that happened to have stale
 * rows as well were reached.
 */
describe('a roster with no redraft link puts its league on the list', () => {
  it('materializes a league listed ONLY because a roster there has no link', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needsWithUnlinked({ leagueId: 'orphans', unlinked: 5 }),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['orphans'])
    expect(out).toMatchObject({ needingWork: 1, carriedOver: 1, unlinkedOnly: 1, refreshed: 1 })
  })

  it('🛑 rows to repair go first, and a link-only league still gets the next slot', async () => {
    // Not a tie-break for its own sake: until a link-only league is materialized ONCE, nothing
    // else will ever list it, so it must not sit behind every league that merely drifts.
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needsWithUnlinked(
        { leagueId: 'linkOnly', unlinked: 9 },
        { leagueId: 'rows', stale: 2, missing: 1 },
      ),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['rows', 'linkOnly'])
    expect(out.unlinkedOnly).toBe(1)
  })

  it('🛑 among leagues with no rows to repair, the most unlinked rosters goes first', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needsWithUnlinked(
        { leagueId: 'few', unlinked: 1 },
        { leagueId: 'many', unlinked: 12 },
      ),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['many', 'few'])
  })

  it('🛑 a league with rows to repair AND unlinked rosters is not counted as link-only', async () => {
    // The count answers "what would this pass have missed before?", so a league the old selector
    // already found must not inflate it.
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: [] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needsWithUnlinked({ leagueId: 'both', stale: 4, unlinked: 3 }),
    })
    expect(out).toMatchObject({ needingWork: 1, unlinkedOnly: 0, refreshed: 1 })
  })

  it('🛑 a league that changed this run and is listed only for a link is NOT skipped as clean', async () => {
    const materialize = vi.fn(async (_leagueId: string) => counts)
    const out = await refreshRedraftRosterPlayersAfterSync({
      results: [{ rosterChangedLeagueIds: ['changed'] }],
      maxLeagues: 10,
      budgetMs: 60_000,
      materialize,
      findLeaguesNeedingWork: needsWithUnlinked({ leagueId: 'changed', unlinked: 2 }),
    })
    expect(materialize.mock.calls.map(([id]) => id)).toEqual(['changed'])
    expect(out).toMatchObject({ skippedClean: 0, carriedOver: 0, unlinkedOnly: 1, refreshed: 1 })
  })
})
