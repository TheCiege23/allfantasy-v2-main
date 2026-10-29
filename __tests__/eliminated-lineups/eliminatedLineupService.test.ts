/**
 * Lineup minimums for eliminated teams — the server half (lib/eliminated-lineups/eliminatedLineupService.ts):
 * the hourly run fills ONLY the short slots, never a starter who meets the standard; it tells a manager
 * once a week; it does nothing without the owner's AF Commissioner; and Commish OS gets one task a week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    playerData: {} as Record<string, unknown>,
  }
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      league: { findUnique: vi.fn() },
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S', currentWeek: 12, playoffStartWeek: 15 })) },
      redraftRoster: { findMany: vi.fn() },
      roster: { findMany: vi.fn() },
      platformNotification: { findFirst: vi.fn(async () => null) },
    },
    elevated: vi.fn(async () => true),
    plan: vi.fn(async () => true),
    lock: vi.fn(async () => ({ locked: false, lockedPlayerIds: [] as string[] })),
    players: vi.fn(),
    persist: vi.fn(async () => ({ ok: true })),
    notify: vi.fn(async () => ({})),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: m.plan }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: m.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: m.persist }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: m.players }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (r: unknown) => r }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => ({ slots: [] })) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
    { index: 2, label: 'WR', allowedPositions: ['WR'], isFlexible: false },
  ],
}))

import {
  readEliminatedLineupTasks,
  readEliminatedLineupView,
  runEliminatedLineupMinimums,
} from '@/lib/eliminated-lineups/eliminatedLineupService'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'

// The out-of-the-race team: its QB is on a bye in week 12 and its WR slot is empty. Its RB meets the
// standard — and a better RB sits on its bench, which the fill must NOT bring in.
const shortLineup = {
  lineup_sections: {
    starters: [{ id: 'qb-bye', position: 'QB', slotIndex: 0 }, { id: 'rb-ok', position: 'RB', slotIndex: 1 }],
    bench: [{ id: 'qb-two', position: 'QB' }, { id: 'wr-two', position: 'WR' }, { id: 'rb-big', position: 'RB' }],
    ir: [], taxi: [], devy: [],
  },
  starters: ['qb-bye', 'rb-ok'],
}
const PLAYERS = [
  { id: 'qb-bye', name: 'Bye Quarterback', position: 'QB', projectedPoints: 0, injuryStatus: null, product: { byeWeek: 12 } },
  { id: 'rb-ok', name: 'Steady Back', position: 'RB', projectedPoints: 9, injuryStatus: null, product: { byeWeek: 7 } },
  { id: 'qb-two', name: 'Backup Quarterback', position: 'QB', projectedPoints: 14, injuryStatus: null, product: { byeWeek: 9 } },
  { id: 'wr-two', name: 'Bench Receiver', position: 'WR', projectedPoints: 8, injuryStatus: null, product: { byeWeek: 10 } },
  { id: 'rb-big', name: 'Big Back', position: 'RB', projectedPoints: 25, injuryStatus: null, product: { byeWeek: 6 } },
]

const RULE = (autoFill: boolean) => ({ eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill } })

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = RULE(true)
  m.state.playerData = structuredClone(shortLineup)
  m.prisma.league.findUnique.mockImplementation(async () => ({
    id: 'L', name: 'Test League', userId: 'owner', platform: 'allfantasy', sport: 'NFL', season: 2026, settings: m.state.settings,
    status: 'in_season', lifecycleState: 'in_season', leagueType: 'redraft', leagueVariant: null, bestBallMode: false,
    guillotineMode: false, lockAllMoves: false, playoffTeams: 2,
  }))
  // 4 teams, 2 make it, line at 8 wins with 3 to play: Cats (3 wins) are out, Dogs (6) are not.
  m.prisma.redraftRoster.findMany.mockResolvedValue([
    { id: 'rr-a', ownerId: 'ua', teamName: 'Aces', ownerName: 'A', wins: 10, losses: 1, ties: 0, playoffSeed: null },
    { id: 'rr-b', ownerId: 'ub', teamName: 'Bees', ownerName: 'B', wins: 8, losses: 3, ties: 0, playoffSeed: null },
    { id: 'rr-d', ownerId: 'ud', teamName: 'Dogs', ownerName: 'D', wins: 6, losses: 5, ties: 0, playoffSeed: null },
    { id: 'rr-c', ownerId: 'uc', teamName: 'Cats', ownerName: 'C', wins: 3, losses: 8, ties: 0, playoffSeed: null },
  ])
  m.prisma.roster.findMany.mockImplementation(async () => [
    { id: 'r-c', platformUserId: 'uc', redraftRosterId: 'rr-c', playerData: m.state.playerData },
    { id: 'r-d', platformUserId: 'ud', redraftRosterId: 'rr-d', playerData: m.state.playerData },
  ])
  m.players.mockResolvedValue(PLAYERS)
  m.plan.mockResolvedValue(true)
  m.prisma.platformNotification.findFirst.mockResolvedValue(null)
})

describe('the hourly run', () => {
  it('fills only the short slots, from the bench — never a starter who already meets the standard', async () => {
    const r = await runEliminatedLineupMinimums()
    expect(r).toMatchObject({ teams: 1, filled: 1, notified: 0 })
    expect(m.persist).toHaveBeenCalledTimes(1)
    const call = (m.persist.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(call).toMatchObject({ leagueId: 'L', rosterId: 'r-c', source: 'system', week: 12, expectedOwnerUserId: 'uc' })
    const starters = buildLineupListsFromPlayerData(call.nextPlayerData, 3).starters
    // The bye QB and the empty WR are replaced; the RB stays even though Big Back projects higher.
    expect(starters).toEqual(['qb-two', 'rb-ok', 'wr-two'])
    expect((call.automationAudit as { message: string }).message).toMatch(/^League rule for eliminated teams: AllFantasy filled Cats's short lineup/)
    // A full lineup is nothing to tell the manager about.
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('with auto-fill off, tells the manager what is short — once that week', async () => {
    m.state.settings = RULE(false)
    const r = await runEliminatedLineupMinimums()
    expect(r).toMatchObject({ filled: 0, notified: 1 })
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['uc'],
      type: 'eliminated_lineup_minimum',
      dedupePrefix: 'eliminated-lineup:L:r-c:2026:12',
      body: expect.stringContaining('1 empty slot; Bye Quarterback on a bye'),
    }))
    // The notice for this team and week already exists: the next hour sends nothing.
    m.notify.mockClear()
    m.prisma.platformNotification.findFirst.mockResolvedValue({ id: 'n1' } as never)
    expect(await runEliminatedLineupMinimums()).toMatchObject({ notified: 0 })
    expect(m.prisma.platformNotification.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceKey: 'eliminated-lineup:L:r-c:2026:12:uc' } }))
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('does nothing while the owner has no AF Commissioner', async () => {
    m.plan.mockResolvedValue(false)
    const r = await runEliminatedLineupMinimums()
    expect(r.skipped).toEqual({ not_entitled: 1 })
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('never fights inactive manager mode, and leaves a locked lineup alone', async () => {
    m.state.settings = { ...RULE(true), af_managed_lineups: { 'r-c': { since: 'x', byUserId: 'c' } } }
    await runEliminatedLineupMinimums()
    expect(m.persist).not.toHaveBeenCalled()
    m.lock.mockResolvedValueOnce({ locked: true, lockedPlayerIds: [] })
    m.state.settings = RULE(true)
    expect((await runEliminatedLineupMinimums()).skipped).toEqual({ lineup_locked: 1 })
  })

  it('skips an imported league and a guillotine league', async () => {
    m.prisma.league.findUnique.mockImplementationOnce(async () => ({ platform: 'sleeper', settings: RULE(true), status: 'in_season' }))
    expect((await runEliminatedLineupMinimums()).skipped).toEqual({ not_native: 1 })
  })
})

describe('the commissioner view and the Commish OS task', () => {
  it('lists the team out of the race with what it is short of, in both languages', async () => {
    const r = await readEliminatedLineupView('L', 'commish')
    expect(r.ok).toBe(true)
    if (!r.ok || !r.view.supported) throw new Error('unsupported')
    expect(r.view).toMatchObject({ rule: { standard: 'playable', autoFill: true }, available: true, week: 12, playoffTeams: 2 })
    expect(r.view.teams).toHaveLength(1)
    expect(r.view.teams[0]).toMatchObject({ rosterId: 'r-c', teamName: 'Cats', reason: 'cannot_reach_line' })
    expect(r.view.teams[0]!.text).toEqual({ en: '1 empty slot; Bye Quarterback on a bye', es: '1 puesto vacío; Bye Quarterback en semana de descanso' })
  })

  it('is for commissioners only', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await readEliminatedLineupView('L', 'member')).toEqual({ ok: false, status: 403 })
  })

  it('files one task for the week; none with the rule off', async () => {
    const tasks = await readEliminatedLineupTasks('L')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ sourceKey: 'eliminated-lineup-minimum:2026:12:v1', title: 'An eliminated team is short of the lineup minimum' })
    expect(tasks[0]!.description).toContain('Cats (1 empty slot; Bye Quarterback on a bye)')
    expect(tasks[0]!.relatedLinks?.[0]?.href).toBe('/core/commissioner?league=L#ch-eliminated-lineups')
    m.state.settings = {}
    expect(await readEliminatedLineupTasks('L')).toEqual([])
  })
})
