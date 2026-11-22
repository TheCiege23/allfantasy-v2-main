import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const board = {
  seasons: [2027, 2028],
  rounds: 4,
  coverage: 'complete',
  teams: [
    { rosterId: 'roster-me', name: 'SF IDP', isViewer: true, bySeason: { 2027: [{ season: 2027, round: 1, label: '1st', fromTeam: null }] }, tradedAwayBySeason: {}, total: 1, firsts: 1 },
    { rosterId: 'roster-hoovi', name: 'Hoovi', isViewer: false, bySeason: {}, tradedAwayBySeason: {}, total: 0, firsts: 0 },
  ],
}
const loadLeaguePickBoard = vi.fn()
vi.mock('@/lib/dynasty-core/leaguePickBoardService', () => ({ loadLeaguePickBoard: (...a: unknown[]) => loadLeaguePickBoard(...a) }))

const leagueRow = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => leagueRow(...a) },
    roster: {
      findMany: async () => [
        { id: 'roster-me', platformUserId: 'sleeper-me', playerData: null },
        { id: 'roster-hoovi', platformUserId: 'sleeper-hoovi', playerData: null },
      ],
    },
    leagueTeam: {
      findMany: async () => [
        { id: 'team-me', externalId: '1', platformUserId: 'sleeper-me', claimedByUserId: null, teamName: 'SF IDP', ownerName: 'me' },
        { id: 'team-hoovi', externalId: '2', platformUserId: 'sleeper-hoovi', claimedByUserId: null, teamName: 'Hoovi', ownerName: 'Hoovi' },
      ],
    },
  },
}))

const loadRookieOrderInput = vi.fn()
vi.mock('@/lib/rookie-order/loadRookieOrderInput', () => ({ loadRookieOrderInput: (...a: unknown[]) => loadRookieOrderInput(...a) }))
const computeRookieOrder = vi.fn()
vi.mock('@/lib/rookie-order/rookieOrderEngine', () => ({ computeRookieOrder: (...a: unknown[]) => computeRookieOrder(...a) }))
vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ readLiveRookieOrderSettings: () => ({ config: { nonPlayoff: 'reverse_record' } }) }))

import { loadFuturePicksView } from '@/lib/league/futurePicksView'

describe('loadFuturePicksView', () => {
  beforeEach(() => {
    loadLeaguePickBoard.mockReset().mockResolvedValue({ ok: true, board, trade: {} })
    leagueRow.mockReset().mockResolvedValue({ leagueType: 'dynasty', isDynasty: true, settings: {} })
    loadRookieOrderInput.mockReset().mockResolvedValue({ season: 2026, input: { teams: [] }, notes: ['Seeds are re-derived.'] })
    computeRookieOrder.mockReset().mockReturnValue({
      phase: 'regular_season',
      warnings: [],
      slots: [
        { slot: 3, teamId: 'team-me', name: 'SF IDP', group: 'non_playoff', status: 'provisional', finish: null, reason: '3rd-worst record' },
        { slot: 9, teamId: 'team-hoovi', name: 'Hoovi', group: 'playoff', status: 'provisional', finish: null, reason: 'Playoff seed 4' },
      ],
    })
  })

  it('joins each board roster to its league team, so standings rows can find their picks', async () => {
    const r = await loadFuturePicksView('L1', 'u1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.view.ids).toEqual([
      { rosterId: 'roster-me', teamId: 'team-me', name: 'SF IDP', isViewer: true },
      { rosterId: 'roster-hoovi', teamId: 'team-hoovi', name: 'Hoovi', isViewer: false },
    ])
  })

  it('projects NEXT season’s draft from the engine, with the commissioner’s config, keyed by team', async () => {
    const r = await loadFuturePicksView('L1', 'u1')
    if (!r.ok) throw new Error('expected ok')
    expect(computeRookieOrder).toHaveBeenCalledWith({ teams: [], config: { nonPlayoff: 'reverse_record' } })
    expect(r.view.projection?.draftSeason).toBe(2027)
    expect(r.view.projection?.slots['team-me']).toEqual({ slot: 3, status: 'provisional', reason: '3rd-worst record', group: 'non_playoff' })
    expect(r.view.projection?.warnings).toContain('Seeds are re-derived.')
  })

  it('has no projection in a redraft league, where the draft order does not carry over', async () => {
    leagueRow.mockResolvedValue({ leagueType: 'redraft', isDynasty: false, settings: {} })
    const r = await loadFuturePicksView('L1', 'u1')
    if (!r.ok) throw new Error('expected ok')
    expect(r.view.projection).toBeNull()
    expect(loadRookieOrderInput).not.toHaveBeenCalled()
  })

  it('passes the board’s access refusal straight through', async () => {
    loadLeaguePickBoard.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect(await loadFuturePicksView('L1', 'u1')).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })
})
