// @vitest-environment node
/**
 * An auto draft fills its own board: best-available picks in draft order through the same submit
 * path the expired-timer autopick uses, then the draft finishes through completeDraftSession so
 * rosters, the season and the Survivor setup follow. Bounded per call; the next tick continues.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: { draftSession: { findFirst: vi.fn(), findMany: vi.fn() } },
  ui: vi.fn(),
  ready: vi.fn(),
  invalidate: vi.fn(),
  submit: vi.fn(),
  append: vi.fn(),
  complete: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: m.ui }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: m.ready }))
vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({ invalidateLeagueDraftCaches: m.invalidate }))
vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({ submitBestAvailableAutopickForExpiredTimer: m.submit }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ appendPickToRosterDraftSnapshot: m.append }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ completeDraftSession: m.complete }))

import { fillAutoDraftBoard, fillAutoDraftBoards } from '@/lib/live-draft-engine/autoDraftFill'

type PickRow = { overall: number; round: number; slot: number; rosterId: string; playerName: string; position: string; pickMetadata: null }

function arrange(opts: { status?: string; draftType?: string; sleeperDraftId?: string | null; executionMode?: string } = {}) {
  const picks: PickRow[] = []
  const slotOrder = [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'B' }]
  m.db.draftSession.findFirst.mockImplementation(async () => ({
    id: 'session', leagueId: 'L1', status: opts.status ?? 'in_progress', draftType: opts.draftType ?? 'snake',
    sleeperDraftId: opts.sleeperDraftId ?? null, rounds: 2, teamCount: 2, thirdRoundReversal: false, slotOrder, tradedPicks: [],
    picks: picks.map((pick) => ({ ...pick })),
  }))
  m.ui.mockResolvedValue({ executionMode: opts.executionMode ?? 'auto' })
  m.ready.mockResolvedValue(true)
  m.complete.mockResolvedValue(true)
  m.append.mockResolvedValue(undefined)
  m.submit.mockImplementation(async (_leagueId: string, rosterId: string, overall: number) => {
    picks.push({ overall, round: overall <= 2 ? 1 : 2, slot: overall === 1 || overall === 4 ? 1 : 2, rosterId, playerName: `Player ${overall}`, position: 'QB', pickMetadata: null })
    return { ok: true, pick: { playerName: `Player ${overall}`, position: 'QB', team: 'KC', playerId: `p${overall}`, byeWeek: 7 } }
  })
  return { picks }
}

describe('fillAutoDraftBoard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drafts best-available in snake order until the board is full, then finishes the draft', async () => {
    const { picks } = arrange()
    const outcome = await fillAutoDraftBoard('L1')
    expect(outcome).toEqual({ leagueId: 'L1', picks: 4, completed: true, stopped: 'board_full' })
    expect(m.submit.mock.calls.map(([, rosterId, overall]) => [rosterId, overall])).toEqual([['r1', 1], ['r2', 2], ['r2', 3], ['r1', 4]])
    expect(picks).toHaveLength(4)
    expect(m.append).toHaveBeenCalledTimes(4)
    expect(m.append).toHaveBeenLastCalledWith('L1', 'r1', { playerName: 'Player 4', position: 'QB', team: 'KC', playerId: 'p4', byeWeek: 7 })
    expect(m.complete).toHaveBeenCalledWith('L1')
    expect(m.invalidate).toHaveBeenCalledWith('L1')
  })

  it('touches nothing in a league that is not an auto draft', async () => {
    arrange({ executionMode: 'live' })
    expect(await fillAutoDraftBoard('L1')).toEqual({ leagueId: 'L1', picks: 0, completed: false, stopped: 'not_auto' })
    expect(m.submit).not.toHaveBeenCalled()
    expect(m.db.draftSession.findFirst).not.toHaveBeenCalled()
  })

  it('yields at its pick budget and lets the next tick continue', async () => {
    arrange()
    expect(await fillAutoDraftBoard('L1', { maxPicks: 2 })).toEqual({ leagueId: 'L1', picks: 2, completed: false, stopped: 'budget' })
    expect(m.complete).not.toHaveBeenCalled()
    expect(await fillAutoDraftBoard('L1', { maxPicks: 10 })).toEqual({ leagueId: 'L1', picks: 2, completed: true, stopped: 'board_full' })
  })

  it('stops when no pick can be made, and reports a draft that is not running', async () => {
    arrange()
    m.submit.mockResolvedValue({ ok: false, error: 'no_pool' })
    expect(await fillAutoDraftBoard('L1')).toEqual({ leagueId: 'L1', picks: 0, completed: false, stopped: 'no_pool' })
    arrange({ status: 'completed' })
    expect(await fillAutoDraftBoard('L1')).toEqual({ leagueId: 'L1', picks: 0, completed: true, stopped: 'status_completed' })
    arrange({ draftType: 'auction' })
    expect(await fillAutoDraftBoard('L1')).toMatchObject({ stopped: 'auction' })
    arrange({ sleeperDraftId: 'sleeper-1' })
    expect(await fillAutoDraftBoard('L1')).toMatchObject({ stopped: 'sleeper_mirrored' })
  })
})

describe('fillAutoDraftBoards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scans in-progress snake and linear drafts we run and fills only the auto ones', async () => {
    arrange()
    m.db.draftSession.findMany.mockResolvedValue([{ leagueId: 'L1' }, { leagueId: 'L2' }])
    m.ui.mockImplementation(async (leagueId: string) => ({ executionMode: leagueId === 'L1' ? 'auto' : 'live' }))
    const summary = await fillAutoDraftBoards({ maxLeagues: 10, budgetMs: 30_000 })
    expect(m.db.draftSession.findMany.mock.calls[0][0].where).toEqual({ status: 'in_progress', sleeperDraftId: null, draftType: { in: ['snake', 'linear'] } })
    expect(summary).toMatchObject({ scanned: 2, filled: 1, picks: 4, completed: 1, errors: [] })
    expect(summary.outcomes.map((outcome) => [outcome.leagueId, outcome.stopped])).toEqual([['L1', 'board_full'], ['L2', 'not_auto']])
  })

  it('records a league that throws and carries on', async () => {
    arrange()
    m.db.draftSession.findMany.mockResolvedValue([{ leagueId: 'L1' }, { leagueId: 'L2' }])
    m.ui.mockImplementation(async (leagueId: string) => { if (leagueId === 'L1') throw new Error('settings unavailable'); return { executionMode: 'auto' } })
    const summary = await fillAutoDraftBoards()
    expect(summary.errors).toEqual([{ leagueId: 'L1', message: 'settings unavailable' }])
    expect(summary).toMatchObject({ scanned: 2, filled: 1, completed: 1 })
  })
})
