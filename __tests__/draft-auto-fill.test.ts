// @vitest-environment node
/**
 * An auto draft fills its own board: best-available picks in draft order through the same submit
 * path the expired-timer autopick uses, then the draft finishes through completeDraftSession so
 * rosters, the season and the Survivor setup follow. Bounded per call; the next tick continues.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: { draftSession: { findFirst: vi.fn(), findMany: vi.fn() }, draftPick: { findFirst: vi.fn() } },
  queuePick: vi.fn(),
  queueKey: vi.fn(),
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
vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  tryQueueAutoPick: m.queuePick,
  draftQueueUserIdForRoster: m.queueKey,
}))

import { fillAutoDraftBoard, fillAutoDraftBoards } from '@/lib/live-draft-engine/autoDraftFill'

type PickRow = { overall: number; round: number; slot: number; rosterId: string; playerName: string; position: string; pickMetadata: null }

function arrange(opts: {
  status?: string; draftType?: string; sleeperDraftId?: string | null; executionMode?: string
  /** `DraftQueue` rows on the session: whose queue (by queue key) holds which players. */
  queues?: Array<{ userId: string; order: unknown }>
} = {}) {
  const picks: PickRow[] = []
  // A team's queue key is its roster id with a `u-` prefix; r1 and r2 are both managed.
  m.queueKey.mockImplementation(async (rosterId: string) => `u-${rosterId}`)
  m.queuePick.mockResolvedValue({ success: false })
  m.db.draftPick.findFirst.mockImplementation(async ({ where }: { where: { overall: number } }) => {
    const made = picks.find((pick) => pick.overall === where.overall)
    return made ? { playerName: made.playerName, position: made.position, team: 'UCF', playerId: `q${made.overall}`, byeWeek: null } : null
  })
  const slotOrder = [{ slot: 1, rosterId: 'r1', displayName: 'A' }, { slot: 2, rosterId: 'r2', displayName: 'B' }]
  m.db.draftSession.findFirst.mockImplementation(async () => ({
    id: 'session', leagueId: 'L1', status: opts.status ?? 'in_progress', draftType: opts.draftType ?? 'snake',
    sleeperDraftId: opts.sleeperDraftId ?? null, rounds: 2, teamCount: 2, thirdRoundReversal: false, slotOrder, tradedPicks: [],
    picks: picks.map((pick) => ({ ...pick })),
    queues: opts.queues ?? [],
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

/**
 * The queue is the only say a manager has in an auto draft. Until 2026-11-25 the fill never read it:
 * every one of a live draft's first 174 picks carried strategy `bpa`.
 */
describe('fillAutoDraftBoard and a manager queue', () => {
  beforeEach(() => vi.clearAllMocks())

  /** r1's queue pick lands as a real pick on the board, as `submitPick` would write it. */
  const queuePicksFor = (picks: PickRow[], rosterIdWithQueue: string) =>
    m.queuePick.mockImplementation(async (_leagueId: string, rosterId: string) => {
      if (rosterId !== rosterIdWithQueue) return { success: false }
      const overall = picks.length + 1
      picks.push({ overall, round: overall <= 2 ? 1 : 2, slot: 1, rosterId, playerName: `Queued ${overall}`, position: 'G', pickMetadata: null })
      return { success: true, playerName: `Queued ${overall}` }
    })

  it('drafts from the queue of the team that has one, and best available for the team that does not', async () => {
    const { picks } = arrange({ queues: [{ userId: 'u-r1', order: [{ playerName: 'Queued', position: 'G' }] }] })
    queuePicksFor(picks, 'r1')

    const outcome = await fillAutoDraftBoard('L1')

    expect(outcome).toEqual({ leagueId: 'L1', picks: 4, completed: true, stopped: 'board_full' })
    // Snake: r1 holds overall 1 and 4, r2 holds 2 and 3.
    expect(picks.map((pick) => [pick.overall, pick.rosterId, pick.playerName])).toEqual([
      [1, 'r1', 'Queued 1'], [2, 'r2', 'Player 2'], [3, 'r2', 'Player 3'], [4, 'r1', 'Queued 4'],
    ])
    expect(m.queuePick.mock.calls.map(([, rosterId]) => rosterId)).toEqual(['r1', 'r1'])
    expect(m.submit.mock.calls.map(([, rosterId, overall]) => [rosterId, overall])).toEqual([['r2', 2], ['r2', 3]])
    // The queue pick is written onto the roster like any other.
    expect(m.append).toHaveBeenCalledTimes(4)
    expect(m.append).toHaveBeenCalledWith('L1', 'r1', { playerName: 'Queued 1', position: 'G', team: 'UCF', playerId: 'q1', byeWeek: null })
  })

  it('falls back to best available when the queue yields no pick, or the queue read throws', async () => {
    arrange({ queues: [{ userId: 'u-r1', order: [{ playerName: 'Gone', position: 'G' }] }] })
    m.queuePick.mockResolvedValueOnce({ success: false, queuePlayerUnavailable: true }).mockRejectedValue(new Error('db'))

    expect(await fillAutoDraftBoard('L1')).toEqual({ leagueId: 'L1', picks: 4, completed: true, stopped: 'board_full' })
    expect(m.submit.mock.calls.map(([, rosterId, overall]) => [rosterId, overall])).toEqual([['r1', 1], ['r2', 2], ['r2', 3], ['r1', 4]])
  })

  it('does no queue work at all when nobody queued a player', async () => {
    arrange({ queues: [{ userId: 'u-r1', order: [] }, { userId: 'u-r2', order: null }] })

    await fillAutoDraftBoard('L1')

    expect(m.queueKey).not.toHaveBeenCalled()
    expect(m.queuePick).not.toHaveBeenCalled()
    expect(m.submit).toHaveBeenCalledTimes(4)
  })

  it('looks up each team once, and never tries the queue for a team nobody manages', async () => {
    const { picks } = arrange({ queues: [{ userId: 'u-r1', order: [{ playerName: 'Queued', position: 'G' }] }] })
    queuePicksFor(picks, 'r1')
    m.queueKey.mockImplementation(async (rosterId: string) => (rosterId === 'r1' ? 'u-r1' : null))

    await fillAutoDraftBoard('L1')

    expect(m.queueKey.mock.calls.map(([rosterId]) => rosterId)).toEqual(['r1', 'r2'])
    expect(m.queuePick.mock.calls.every(([, rosterId]) => rosterId === 'r1')).toBe(true)
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
