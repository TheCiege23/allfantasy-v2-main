import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, platform: 'allfantasy', league: {} as Record<string, unknown> }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
  }
  return {
    state,
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      league: { findUnique: vi.fn(async (args: { select?: unknown }) => (args.select ? { platform: state.platform, settings: state.settings } : { ...state.league, settings: state.settings, platform: state.platform })) },
      roster: { findFirst: vi.fn() },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
    health: vi.fn(),
    lock: vi.fn(),
    players: vi.fn(),
    persist: vi.fn(),
    template: vi.fn(async () => ({ slots: [] })),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: m.health }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: m.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: m.persist }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: m.players }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (r: unknown) => r }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: m.template }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
}))

import {
  ENDED_ACTION,
  endInactiveManagerModeOnOwnerSave,
  OFF_ACTION,
  ON_ACTION,
  readInactiveManagerView,
  runInactiveManagerLineups,
  setInactiveManagerMode,
} from '@/lib/inactive-manager/inactiveManagerService'

const managedMap = () => (m.state.settings.af_managed_lineups ?? {}) as Record<string, unknown>
const playerData = {
  lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }, { id: 'rb-out', position: 'RB', slotIndex: 1 }], bench: [{ id: 'rb-good', position: 'RB' }], ir: [], taxi: [], devy: [] },
  starters: ['qb', 'rb-out'],
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = { other: 1 }
  m.state.platform = 'allfantasy'
  m.state.league = { id: 'L', sport: 'NFL', season: 2026, status: 'in_season', lifecycleState: 'in_season', bestBallMode: false, lockAllMoves: false, leagueType: 'redraft', leagueVariant: null }
  m.elevated.mockResolvedValue(true)
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'r1', platformUserId: 'owner', playerData })
  m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: [] })
  m.players.mockResolvedValue([{ id: 'qb', position: 'QB', projectedPoints: 20 }, { id: 'rb-out', position: 'RB', projectedPoints: 0 }, { id: 'rb-good', position: 'RB', projectedPoints: 12 }])
  m.persist.mockResolvedValue({ ok: true })
})

describe('the commissioner switch', () => {
  it('turns a team on, keeps other settings, and logs it', async () => {
    expect(await setInactiveManagerMode('L', 'commish', 'r1', true)).toEqual({ ok: true, managed: true })
    expect(m.state.settings.other).toBe(1)
    expect(managedMap().r1).toMatchObject({ byUserId: 'commish' })
    expect(m.tx.$queryRaw).toHaveBeenCalled()
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: ON_ACTION, entityId: 'r1', userId: 'commish' }))
  })

  it('does nothing and logs nothing when the team is already in that state', async () => {
    await setInactiveManagerMode('L', 'commish', 'r1', true)
    m.log.mockClear()
    expect(await setInactiveManagerMode('L', 'commish', 'r1', true)).toEqual({ ok: true, managed: true })
    expect(m.log).not.toHaveBeenCalled()
  })

  it('turns it off, removing the key when no team is left', async () => {
    await setInactiveManagerMode('L', 'commish', 'r1', true)
    await setInactiveManagerMode('L', 'commish', 'r1', false)
    expect(m.state.settings).not.toHaveProperty('af_managed_lineups')
    expect(m.log).toHaveBeenLastCalledWith(expect.objectContaining({ actionType: OFF_ACTION }))
  })

  it('refuses a member, a bad request, an imported league and another league’s team', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await setInactiveManagerMode('L', 'm1', 'r1', true)).toMatchObject({ ok: false, status: 403 })
    expect(await setInactiveManagerMode('L', 'commish', 'r1', 'yes')).toMatchObject({ ok: false, status: 400 })
    m.state.platform = 'sleeper'
    expect(await setInactiveManagerMode('L', 'commish', 'r1', true)).toMatchObject({ ok: false, status: 409 })
    m.state.platform = 'allfantasy'
    m.prisma.roster.findFirst.mockResolvedValueOnce(null)
    expect(await setInactiveManagerMode('L', 'commish', 'r9', true)).toMatchObject({ ok: false, status: 404 })
    expect(m.state.settings).not.toHaveProperty('af_managed_lineups')
  })
})

describe('the owner coming back', () => {
  it('ends it and logs that the manager is back', async () => {
    m.state.settings = { af_managed_lineups: { r1: { since: 'x', byUserId: 'c' }, r2: { since: 'x', byUserId: 'c' } } }
    expect(await endInactiveManagerModeOnOwnerSave('L', 'r1', 'owner')).toBe(true)
    expect(Object.keys(managedMap())).toEqual(['r2'])
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: ENDED_ACTION, userId: 'owner', entityId: 'r1', metadata: { rosterId: 'r1', reason: 'owner_saved_lineup' } }))
  })

  it('does nothing for a team that is not managed', async () => {
    expect(await endInactiveManagerModeOnOwnerSave('L', 'r1', 'owner')).toBe(false)
    expect(m.prisma.$transaction).not.toHaveBeenCalled()
    expect(m.log).not.toHaveBeenCalled()
  })
})

describe('the view', () => {
  it('lists every team, suggests inactive ones not yet managed', async () => {
    m.state.settings = { af_managed_lineups: { r2: { since: 's', byUserId: 'c' } } }
    m.health.mockResolvedValue({ rows: [
      { rosterId: 'r1', teamName: 'A', managerName: 'a', status: 'inactive', lastActionAt: null },
      { rosterId: 'r2', teamName: 'B', managerName: 'b', status: 'inactive', lastActionAt: null },
      { rosterId: 'r3', teamName: 'C', managerName: 'c', status: 'active', lastActionAt: null },
    ] })
    const view = await readInactiveManagerView('L')
    expect(view.teams.map((t) => [t.rosterId, t.suggested, Boolean(t.managed)])).toEqual([['r1', true, false], ['r2', false, true], ['r3', false, false]])
  })
})

describe('the hourly run', () => {
  beforeEach(() => {
    m.state.settings = { current_week: 7, af_managed_lineups: { r1: { since: 'x', byUserId: 'c' } } }
  })

  it('skips a league with no current week', async () => {
    m.state.settings = { af_managed_lineups: { r1: { since: 'x', byUserId: 'c' } } }
    expect((await runInactiveManagerLineups()).skipped.no_week).toBe(1)
    expect(m.persist).not.toHaveBeenCalled()
  })

  it("sets the projected-best lineup as AllFantasy's own system save, on the owner's behalf", async () => {
    const r = await runInactiveManagerLineups()
    expect(r).toMatchObject({ leagues: 1, teams: 1, set: 1 })
    const args = m.persist.mock.calls[0][0]
    expect(args).toMatchObject({ leagueId: 'L', rosterId: 'r1', source: 'system', actorUserId: 'owner', expectedOwnerUserId: 'owner', expectedStarters: ['qb', 'rb-out'], season: 2026, week: 7 })
    expect(args.automationAudit).toMatchObject({ action: 'inactive_manager.lineup_set', metadata: { changes: [{ slot: 'RB', in: 'rb-good', out: 'rb-out' }] } })
    expect(m.players).toHaveBeenCalledWith(expect.objectContaining({ surface: 'roster', leagueId: 'L', userId: 'owner' }))
  })

  it('says Chimmy set the lineup on a team Chimmy runs, and AllFantasy on one it only manages', async () => {
    m.state.settings = { current_week: 7, af_managed_lineups: { r1: { since: 's', byUserId: 'c', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'c' } } } }
    await runInactiveManagerLineups()
    expect(m.persist.mock.calls[0][0].automationAudit.message).toMatch(/^Chimmy set the best lineup/)
    m.persist.mockClear()
    m.state.settings = { current_week: 7, af_managed_lineups: { r1: { since: 's', byUserId: 'c' } } }
    await runInactiveManagerLineups()
    expect(m.persist.mock.calls[0][0].automationAudit.message).toMatch(/^AllFantasy set the best lineup/)
  })

  it('writes nothing when the lineup is already the best', async () => {
    m.players.mockResolvedValue([{ id: 'qb', position: 'QB', projectedPoints: 20 }, { id: 'rb-out', position: 'RB', projectedPoints: 15 }, { id: 'rb-good', position: 'RB', projectedPoints: 12 }])
    expect(await runInactiveManagerLineups()).toMatchObject({ set: 0, unchanged: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('benches a starter whose bye week is this week, though his projection says he will score', async () => {
    m.players.mockResolvedValue([
      { id: 'qb', position: 'QB', projectedPoints: 20 },
      { id: 'rb-out', position: 'RB', projectedPoints: 15, product: { byeWeek: 7 } },
      { id: 'rb-good', position: 'RB', projectedPoints: 12, product: { byeWeek: 9 } },
    ])
    expect(await runInactiveManagerLineups()).toMatchObject({ set: 1 })
    expect(m.persist.mock.calls[0][0].automationAudit.metadata.changes).toEqual([{ slot: 'RB', in: 'rb-good', out: 'rb-out' }])
  })

  it('never moves a player whose game has started', async () => {
    m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: ['rb-out'] })
    expect(await runInactiveManagerLineups()).toMatchObject({ set: 0, unchanged: 1 })
  })

  it.each([
    ['imported league', () => { m.state.platform = 'sleeper' }, 'not_native'],
    ['best ball', () => { m.state.league.bestBallMode = true }, 'automatic_lineups'],
    ['offseason', () => { m.state.league.status = 'offseason'; m.state.league.lifecycleState = 'offseason' }, 'not_in_season'],
    ['moves locked', () => { m.state.league.lockAllMoves = true }, 'moves_locked'],
  ])('skips a league that is an %s', async (_label, set, reason) => {
    set()
    const r = await runInactiveManagerLineups()
    expect(r.skipped[reason]).toBe(1)
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('skips a locked lineup, and counts a refused save', async () => {
    m.lock.mockResolvedValueOnce({ locked: true, lockedPlayerIds: [] })
    expect((await runInactiveManagerLineups()).skipped.lineup_locked).toBe(1)
    m.persist.mockResolvedValueOnce({ ok: false, error: 'locked by commissioner', status: 403 })
    expect((await runInactiveManagerLineups()).skipped['save_refused:403']).toBe(1)
  })

  it('records a failure for one team and carries on', async () => {
    m.players.mockRejectedValueOnce(new Error('db down'))
    expect((await runInactiveManagerLineups()).failures).toEqual([{ leagueId: 'L', rosterId: 'r1', error: 'db down' }])
  })
})
