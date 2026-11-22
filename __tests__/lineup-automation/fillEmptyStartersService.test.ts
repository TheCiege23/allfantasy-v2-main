/**
 * The hourly "fill an empty starting spot" run (lib/lineup-automation/fillEmptyStartersService.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { league: {} as Record<string, unknown>, rosters: [] as Array<Record<string, unknown>>, cache: new Map<string, { createdAt: Date }>() }
  return {
    state,
    prisma: {
      sportsDataCache: {
        findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => state.cache.get(where.cacheKey) ?? null),
        create: vi.fn(async ({ data }: { data: { cacheKey: string; createdAt: Date } }) => {
          if (state.cache.has(data.cacheKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
          state.cache.set(data.cacheKey, { createdAt: data.createdAt })
          return data
        }),
      },
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      league: { findUnique: vi.fn(async () => state.league) },
      roster: { findMany: vi.fn(async () => state.rosters) },
    },
    lock: vi.fn(),
    players: vi.fn(),
    persist: vi.fn(),
    notify: vi.fn(async () => ({})),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: m.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: m.persist }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: m.players }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (r: unknown) => r }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: async () => ({ slots: [] }) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
    { index: 2, label: 'TE', allowedPositions: ['TE'], isFlexible: false },
  ],
}))

import { runFillEmptyStarters, FILL_EMPTY_STARTERS_ACTION } from '@/lib/lineup-automation/fillEmptyStartersService'

const NOW = new Date('2026-10-29T15:00:00Z')
const OLD = new Date('2026-10-29T08:00:00Z')
// The RB spot is empty and a running back sits on the bench; nobody can play TE.
const playerData = {
  lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }], bench: [{ id: 'rb', position: 'RB' }], ir: [], taxi: [], devy: [] },
  starters: ['qb'],
}
const full = {
  lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }, { id: 'rb', position: 'RB', slotIndex: 1 }, { id: 'te', position: 'TE', slotIndex: 2 }], bench: [], ir: [], taxi: [], devy: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.league = { id: 'L', userId: 'commish', name: 'Dynasty', sport: 'NFL', season: 2026, status: 'in_season', lifecycleState: 'in_season', platform: 'allfantasy', settings: { current_week: 7 }, bestBallMode: false, lockAllMoves: false, leagueType: 'dynasty', leagueVariant: null }
  m.state.rosters = [{ id: 'r1', platformUserId: 'owner', playerData, updatedAt: OLD }]
  m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: [] })
  m.players.mockResolvedValue([
    { id: 'qb', name: 'Quarterback', position: 'QB', projectedPoints: 20, product: { byeWeek: 10 } },
    { id: 'rb', name: 'Bench Back', position: 'RB', projectedPoints: 9, product: { byeWeek: 12 } },
  ])
  m.persist.mockResolvedValue({ ok: true })
  // The owner was told seven hours ago (./automationHeadsUp.ts), so this run fills.
  m.state.cache = new Map([['af-heads-up:fill_empty_starters:r1:2026:7', { createdAt: OLD }]])
})

describe('runFillEmptyStarters', () => {
  it('first tells the owner what it will fill, and changes nothing', async () => {
    m.state.cache.clear()
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r).toMatchObject({ teams: 1, warned: 1, filled: 0, flagged: 0 })
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.notify).toHaveBeenCalledTimes(1)
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['owner'], type: 'fill_empty_starters_heads_up', body: expect.stringContaining('start Bench Back at RB unless you set your lineup yourself') }))
    // The next run, an hour later, still waits.
    const again = await runFillEmptyStarters({ now: new Date(NOW.getTime() + 3_600_000) })
    expect(again).toMatchObject({ warned: 0, filled: 0, skipped: { heads_up_pending: 1 } })
    expect(m.persist).not.toHaveBeenCalled()
    // Three hours after the heads-up, it fills.
    expect(await runFillEmptyStarters({ now: new Date(NOW.getTime() + 3 * 3_600_000) })).toMatchObject({ filled: 1 })
  })

  it('fills at once without waiting when games are already under way this week', async () => {
    m.state.cache.clear()
    m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: ['qb'] })
    expect(await runFillEmptyStarters({ now: NOW })).toMatchObject({ warned: 0, filled: 1 })
    expect(m.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fill_empty_starters_heads_up' }))
  })

  it('never fills when the heads-up could not be recorded', async () => {
    m.state.cache.clear()
    m.prisma.sportsDataCache.create.mockRejectedValueOnce(new Error('db down'))
    expect(await runFillEmptyStarters({ now: NOW })).toMatchObject({ warned: 0, filled: 0, skipped: { heads_up_pending: 1 } })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('fills the empty spot as a system save, tells the owner, and tells the commissioner about the spot nobody can play', async () => {
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r).toMatchObject({ leagues: 1, teams: 1, filled: 1, flagged: 1, failures: [] })
    const args = m.persist.mock.calls[0][0]
    expect(args).toMatchObject({ leagueId: 'L', rosterId: 'r1', source: 'system', actorUserId: 'owner', expectedOwnerUserId: 'owner', expectedStarters: ['qb'], season: 2026, week: 7 })
    expect(args.automationAudit).toMatchObject({ action: FILL_EMPTY_STARTERS_ACTION, metadata: { changes: [{ slot: 'RB', in: 'rb' }], unfilled: ['TE'] } })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['owner'], type: 'fill_empty_starters' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish'], type: 'fill_empty_starters_short', dedupePrefix: 'fill-empty-starters-short:L:r1:2026:7' }))
  })

  it('reads no players for a full lineup', async () => {
    m.state.rosters = [{ id: 'r1', platformUserId: 'owner', playerData: full, updatedAt: OLD }]
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r).toMatchObject({ teams: 0, filled: 0 })
    expect(m.players).not.toHaveBeenCalled()
  })

  it('leaves a lineup saved in the last three hours alone', async () => {
    m.state.rosters = [{ id: 'r1', platformUserId: 'owner', playerData, updatedAt: new Date('2026-10-29T13:30:00Z') }]
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r.skipped).toEqual({ recently_edited: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('does nothing when the commissioner switched it off', async () => {
    m.state.league = { ...m.state.league, settings: { current_week: 7, fill_empty_starters: false } }
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r.skipped).toEqual({ switched_off: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('leaves a team AllFantasy or Chimmy already manages to that run', async () => {
    m.state.league = { ...m.state.league, settings: { current_week: 7, af_managed_lineups: { r1: { byUserId: 'commish', since: '2026-10-01T00:00:00.000Z' } } } }
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r.skipped).toEqual({ managed_by_autopilot: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('does not touch a lineup that is locked', async () => {
    m.lock.mockResolvedValue({ locked: true, lockedPlayerIds: [] })
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r.skipped).toEqual({ lineup_locked: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('skips an imported league', async () => {
    m.state.league = { ...m.state.league, platform: 'sleeper' }
    const r = await runFillEmptyStarters({ now: NOW })
    expect(r.skipped).toEqual({ not_native: 1 })
  })
})
